import fetch from 'isomorphic-fetch';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import {isNil} from 'ramda';
import csv from 'fast-csv';
import multer from 'multer';

const storage = multer.diskStorage({
  destination: './uploads',
  filename(req, file, cb) {
    cb(null, `${new Date()}-${file.originalname}`);
  },
});
const upload = multer({storage});

import {upsert as upsertUser} from './db/user';
import {create as createRace, load as loadRaces, update as updateRace, deleteRace as removeRace} from './db/race';
import logger from './logger';

const SEVEN_DAYS_IN_SECONDS = 60 * 60 * 24 * 7;
const SECRET = fs.readFileSync('private.key');
/**
 * Handles authenticating with strava, by exchanging the OAuth code for an access token
 * @param {object} req The express request object
 * @param {object} res The express response object
 */
const authenticate = (req, res) => {
  const {code} = req.body;
  const clientSecret = process.env.JORNET_STRAVA_CLIENT_SECRET;
  const clientId = process.env.JORNET_STRAVA_CLIENT_ID;

  const config = {
    method: 'post',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'jornet',
    },
    body: JSON.stringify({code, client_secret: clientSecret, client_id: clientId}),
  };

  logger.log(`Making request to Strava with config: ${JSON.stringify(config)}`);
  return fetch('https://www.strava.com/oauth/token', config)
    .then(response => {
      return response.json().then(json => {
        if (!response.ok) {
          res.status(502);
          res.json(json);
          return null;
        }

        return upsertUser(json).then(jornetUser => {
          logger.log(`Creating JWT token for jornet user: ${jornetUser.id}`);
          const jwtToken = jwt.sign(
            {
              jornetUser,
            },
            SECRET,
            {expiresIn: SEVEN_DAYS_IN_SECONDS},
          );
          return res.json({
            ...jornetUser,
            token: jwtToken,
          });
        });
      });
    })
    .catch(e => {
      logger.error(e);
      if (e.name && e.name === 'FetchError') {
        res.status(502);
        return res.json({error: 'Failed to exchange OAuth code for access token', details: e.reason});
      }

      res.status(500);
      return res.json({error: 'Failed to exchange OAuth code for access token'});
    });
};

/** /races */
const postRace = (req, res) => {
  return createRace(req.body)
    .then(race => res.json(race))
    .catch(e => {
      logger.error(`$Failed to create race: ${e}`);
      const msg = e.column ? `${e.column} is required` : 'Failed to create race';
      res.status(400);
      res.json({error: msg});
    });
};

const getRaces = (req, res) => {
  const search = req.query ? req.query : {};
  return loadRaces(search)
    .then(races => res.json(races))
    .catch(e => {
      logger.error(`Failed to search ${e}`);
      res.status(400);
      res.json({error: 'Invalid search criteria'});
    });
};

const putRace = (req, res) => {
  return updateRace(req.params.id, req.body)
    .then(race => res.json(race))
    .catch(e => {
      logger.error(`Failed to update race: ${e}`);
      const msg = e.column ? `${e.column} is required` : 'Failed to update race';
      res.status(400);
      res.json({error: msg});
    });
};

const deleteRace = (req, res) => {
  return removeRace(req.params.id)
    .then(() => {
      res.status(204);
      res.end();
    })
    .catch(e => {
      logger.error(`Failed to delete race: ${e}`);
      res.status(400);
      res.json({error: 'Failed to delete race'});
    });
};

const withLatLng = race => {
  const config = {
    method: 'get',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'jornet',
    },
  };

  return fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${race.location}&key=${process.env
      .JORNET_GOOGLE_MAPS_KEY}`,
    config,
  ).then(response => {
    return response.json().then(json => {
      if (json.error_message) {
        logger.log(`Failed to load lat/lng: ${race.error_message}`);
        return Object.assign({}, race);
      }
      const geometry = json.results ? json.results[0].geometry : {};
      return Object.assign({}, race, {
        latitude: geometry.location.lat,
        longitude: geometry.location.lng,
      });
    });
  });
};

const bulkPostRaces = (req, res) => {
  const stream = fs.createReadStream(req.file.path);
  let uploadedCount = 0;
  csv
    .fromStream(stream, {headers: true})
    .on('data', race => {
      console.log(`Checking to see if there is a race with name: ${race.name} and distance: ${race.distance}`);
      return loadRaces({name: race.name, distance: race.distance}).then(races => {
        if (races.length > 0) {
          logger.log(`Not inserting ${race.name} as it already exists.`);
          return null;
        }
        logger.log(`Creating race with name: ${race.name}`);
        return withLatLng(race).then(hydratedRace => {
          if (!hydratedRace.latitude || !hydratedRace.longitude) {
            logger.log(`Could not find lat/lng for ${race.name}, not creating.`);
            return null;
          }
          uploadedCount++;
          return createRace(hydratedRace);
        });
      });
    })
    .on('end', () => {
      fs.unlinkSync(req.file.path);
      res.header('X-Cairn-Bulk-Results', `${uploadedCount}`);
      res.status(200).end();
    });
};

/**
 * Ensures that the given request has a valid Bearer token
 * @param {object} req The express request object
 * @param {object} res The express response object
 * @param {Function} next Next function
 */
const authMiddleware = (req, res, next, isAdminRequired = false) => {
  // check if the user is authenticated and, if so, attach user to the request
  const bearer = req.headers.authorization;
  if (isNil(bearer)) {
    res.status(401);
    return res.json({error: 'Invalid bearer token'});
  }

  const onJwtDecoded = (err, decodedJwt) => {
    if (err) {
      logger.error(`Failed to decode bearer token: ${err}`);
      res.status(401);
      return res.json({error: 'Bearer token has expired'});
    }

    // validate admin privileges
    if (isAdminRequired && !decodedJwt.jornetUser.is_admin) {
      logger.error(`${decodedJwt.jornetUser.email_address} is not an admin but is trying to execute ${req.url}`);
      res.status(403);
      return res.json({error: 'Admin prilileges required to execute this API'});
    }

    req.user = decodedJwt.jornetUser;
    return next();
  };

  // Bearer abc --> abc
  const token = bearer.split(' ')[1];
  return jwt.verify(token, SECRET, onJwtDecoded);
};

const adminMiddleware = (req, res, next) => authMiddleware(req, res, next, true);

/**
 * Top level function that defines what functions will handle what API requests
 * @param {object} expressApp The express app to add any API definitions to
 */
const init = expressApp => {
  expressApp.disable('x-powered-by');
  expressApp.use(bodyParser.json());

  /* authenticating in via OAuth */
  expressApp.post('/api/oauth', authenticate);

  /* retrieve all races */
  expressApp.get('/api/races', authMiddleware, getRaces);

  // requires admin privileges
  expressApp.post('/api/races', adminMiddleware, postRace);
  expressApp.post('/api/bulk/races', [adminMiddleware, upload.single('file')], bulkPostRaces);
  expressApp.patch('/api/races/:id', adminMiddleware, putRace);
  expressApp.delete('/api/races/:id', adminMiddleware, deleteRace);
};

export default init;
