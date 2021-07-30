/**
 * index.ts
 * 
 * Main script to run WA-forwarder
 */

import { Debug } from './debug';                // Logging for different debug lebels
import { Config } from './config';              // WA client and forwarder config
import { WAForwarder } from './waforwarder';    // WA Forwarder

import { create, Client, ev } from './wa-automate-nodejs/src/index';
const fs = require('fs');                       // needed to write qr to disc 
const ON_DEATH = require('death');              // detect kill signal (not working!)



/**
 * Creates instance of the fordwarder (after client has been started)
 * 
 * @param client 
 */
export async function start(client: Client) {
  new WAForwarder(client);
}

// Create and start a WA client 
create(Config.clientConfig)
  .then(async client => await start(client))
  .catch(e => {
    Debug.log(Debug.ERROR, 'Error', e.message);
    if (WAForwarder.globalClient !== undefined) {
      async () => await WAForwarder.globalClient.sendText(`${Config.remotePhoneNumber}@c.us`, "*Forwarder crashed*\n${e.message}");
    }
  });


// TODO: Fix this, it is not working
// Begin reading from stdin so the process does not exit.
process.stdin.resume();
process.on('SIGINT', function() {
  Debug.log(Debug.VERBOSE, "WA-Forwarder interrupted by user")
  if (WAForwarder.globalClient !== undefined) {
    async () => {
      await WAForwarder.globalClient.sendText(`${Config.remotePhoneNumber}@c.us`, "*Forwarder interrupted by user*");
      process.exit();
    }
  } else {
    process.exit();
  }
  
});  

/**********************************************************************************************************/

// Debug logging      

/**
 * Kill session
 */
ON_DEATH(async function (signal, err) {
  Debug.log(Debug.DEBUG, 'killing session');
  if (WAForwarder.globalClient) await WAForwarder.globalClient.kill();
})

/**
 * Detect the qr code
 */
ev.on('qr.**', async (qrcode, sessionId) => {
  //base64 encoded qr code image
  const imageBuffer = Buffer.from(qrcode.replace('data:image/png;base64,', ''), 'base64');
  fs.writeFileSync(`qr_code${sessionId ? '_' + sessionId : ''}.png`, imageBuffer);
});

/**
 * Detect when a session has been started successfully
 */
ev.on('STARTUP.**', async (data, sessionId) => {
  if (data === 'SUCCESS') Debug.log(Debug.VERBOSE, `${sessionId} started!`)
})

/**
 * Detect all events
 */
ev.on('**', async (data,sessionId,namespace) => {
  Debug.log(Debug.INFORMATION, "\n----------")
  Debug.log(Debug.INFORMATION, 'EV',data,sessionId,namespace)
  Debug.log(Debug.INFORMATION, "----------")
})

/**
 * Detect the session data object
 */
ev.on('sessionData.**', async (sessionData, sessionId) =>{
  Debug.log(Debug.INFORMATION, "\n----------")
  Debug.log(Debug.INFORMATION, 'sessionData',sessionId, sessionData)
  Debug.log(Debug.INFORMATION, "----------")
})

/**
 * Detect the session data object encoded as a base64string
 */
ev.on('sessionDataBase64.**', async (sessionData, sessionId) =>{
  Debug.log(Debug.INFORMATION, "\n----------")
  Debug.log(Debug.INFORMATION, 'sessionData',sessionId, sessionData)
  Debug.log(Debug.INFORMATION, "----------")
})  