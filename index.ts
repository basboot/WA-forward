// Import class with configuration parameters
import { Config } from './config';

import { create, Client, decryptMedia, ev, smartUserAgent, NotificationLanguage, MessageTypes, ChatMuteDuration } from '../src/index';
import { CLIENT_RENEG_WINDOW } from 'tls';
const mime = require('mime-types');
const fs = require('fs');
const uaOverride = 'WhatsApp/2.16.352 Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Safari/605.1.15';
const tosBlockGuaranteed = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/79.0.3945.88 Safari/537.36";
const ON_DEATH = require('death');
let globalClient: Client;
const express = require('express')

const app = express()
app.use(express.json({ limit: '200mb' })) //add the limit option so we can send base64 data through the api

const PORT = 8082;


ON_DEATH(async function (signal, err) {
  console.log('killing session');
  if (globalClient) await globalClient.kill();
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
  if (data === 'SUCCESS') console.log(`${sessionId} started!`)
})

/**
 * Detect all events
 */
ev.on('**', async (data,sessionId,namespace) => {
  console.log("\n----------")
  console.log('EV',data,sessionId,namespace)
  console.log("----------")
})

/**
 * Detect the session data object
 */
ev.on('sessionData.**', async (sessionData, sessionId) =>{
  console.log("\n----------")
  console.log('sessionData',sessionId, sessionData)
  console.log("----------")
})

/**
 * Detect the session data object encoded as a base64string
 */
ev.on('sessionDataBase64.**', async (sessionData, sessionId) =>{
  console.log("\n----------")
  console.log('sessionData',sessionId, sessionData)
  console.log("----------")
})

async function start(client: Client) {
  app.use(client.middleware(true));

  app.listen(PORT, function () {
    console.log(`\n• Listening on port ${PORT}!`);
  });

  globalClient = client;
  console.log(`Starting WA-forwarder for: ${Config.remotePhoneNumber}`)
  const me = await client.getMe();
  console.log("start -> me", me);

  client.onAck((c: any) => console.log(c.id, c.body, c.ack));
  client.onAddedToGroup(newGroup => console.log('Added to new Group', newGroup.id));
  client.onIncomingCall(call => console.log('newcall', call));

  const prods = await client.getBusinessProfilesProducts(me.wid)
  console.log(prods)

  client.onStateChanged(state => {
    console.log('statechanged', state)
    if (state === "CONFLICT" || state === "UNLAUNCHED") client.forceRefocus();
  });

  client.onAnyMessage(message => {
    console.log(message.type)
  });

  client.onMessage(async message => {
    console.log("--- NEW MESSAGE ---");
    console.log(message);

    try {
      let txtMessage = "";
      if (message.type == MessageTypes.TEXT) {
        txtMessage = message.body;
        if (message.quotedMsg != null) {
          console.log("THIS IS A REPLY");


          if (message.from == `${Config.remotePhoneNumber}@c.us`) {
            let contactId = message.quotedMsg.content.split('\n')[1];
            console.log(`Relay this message to: ${contactId}`)
          } else {
            console.log("Not from remote phone, so it is a 'normal' message");
          }
        }
      } else {
        txtMessage = `Received message of type '${message.type}'`;
      }

      if (message.type == MessageTypes.IMAGE) {
        console.log(">>> Send image");
        const filename = `${message.t}.${mime.extension(message.mimetype)}`;

        let mediaData = await decryptMedia(message, uaOverride);
        await client.sendImage(`${Config.remotePhoneNumber}@c.us`,
          `data:${message.mimetype};base64,${mediaData.toString('base64')}`,
          filename,
          `*${message.sender.formattedName}:* ${txtMessage} (${message.chat.formattedTitle})\n${message.from}`);
      } else {
        console.log(">>> Send text");
        client.sendText(`${Config.remotePhoneNumber}@c.us`, `*${message.sender.formattedName}:* ${txtMessage} (${message.chat.formattedTitle})\n${message.from}`);
      }
    } catch (error) {
      console.log("Problem in 'onMessage' -> error", error);
    }
  });
}

/**
 * it can be null, which will default to 'session' folder.
 * You can also override some puppeteer configs, set an executable path for your instance of chrome for ffmpeg (video+GIF) support
 * and you can AND SHOULD override the user agent.
 */
create({
  sessionId: 'WA-forwarder',
  useChrome: true,
  restartOnCrash: start,
  headless: false,
  throwErrorOnTosBlock: true,
  qrTimeout: 0,   //set to 0 to wait forever for a qr scan
  authTimeout: 0, //set to 0 to wait forever for connection to phone
  killProcessOnBrowserClose: true,
  autoRefresh: true, //default to true
  safeMode: true,
  disableSpins: true,
  hostNotificationLang: NotificationLanguage.PTBR,
  viewport: {
    // width: 1920,
    height: 1200
  },
  popup: 3012,
  defaultViewport: null,
  // cacheEnabled:false,
  // devtools:true,
  //OR
  // devtools:{
  //   user:'admin',
  //   pass:'root'
  // },
  //example chrome args. THIS MAY BREAK YOUR APP !!!ONLY FOR TESTING FOR NOW!!!.
  // chromiumArgs:[
  //   '--aggressive-cache-discard',
  //   '--disable-cache',
  //   '--disable-application-cache',
  //   '--disable-offline-load-stale-cache',
  //   '--disk-cache-size=0'
  // ]
})
  // create()
  .then(async client => await start(client))
  .catch(e => {
    console.log('Error', e.message);
    // process.exit();
  });

