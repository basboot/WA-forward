// Import class with configuration parameters
import { Debug } from './debug';
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
  Debug.log(Debug.DEBUG, 'killing session');
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

async function start(client: Client) {
  app.use(client.middleware(true));

  app.listen(PORT, function () {
    Debug.log(Debug.VERBOSE, `\n• Listening on port ${PORT}!`);
  });

  globalClient = client;
  Debug.log(Debug.VERBOSE, `Starting WA-forwarder for: ${Config.remotePhoneNumber}`)
  const me = await client.getMe();
  Debug.log(Debug.INFORMATION, "start -> me", me);

  client.onAck((c: any) => Debug.log(Debug.VERBOSE, c.id, c.body, c.ack));
  client.onAddedToGroup(newGroup => Debug.log(Debug.VERBOSE, 'Added to new Group', newGroup.id));
  client.onIncomingCall(call => Debug.log(Debug.VERBOSE, 'newcall', call));

  const prods = await client.getBusinessProfilesProducts(me.wid)
  Debug.log(Debug.VERBOSE, prods)

  client.onStateChanged(state => {
    Debug.log(Debug.VERBOSE, 'statechanged', state)
    if (state === "CONFLICT" || state === "UNLAUNCHED") client.forceRefocus();
  });

  client.onAnyMessage(message => {
    Debug.log(Debug.VERBOSE, 'Message detected of type: ', message.type)
  });

  client.onMessage(async message => {
    Debug.log(Debug.VERBOSE, '--- Processing new message ---')
    Debug.log(Debug.DEBUG, message);

    let messageFromMe = false;
    if (message.from == `${Config.remotePhoneNumber}@c.us`) {
      messageFromMe = true;
      Debug.log(Debug.DEBUG, `Message from self, relay or process command`)
    } else {
      Debug.log(Debug.DEBUG, "Not from remote phone, so it is a 'normal' message");
    }

    // TODO: CLEANUP

    // TODO: forward text per ongeluk weggegooid????

    let txtMessage = "";

    if (messageFromMe) {
      // process message from self
      try {
        if (message.type == MessageTypes.TEXT) {
          txtMessage = message.body;
          // Received a reply to forwarderd message => Relay message to original sender
          if (message.quotedMsg != null) {
            // TODO: Check quotedMsg format
            Debug.log(Debug.DEBUG, "Received a reply to forwarderd message => Relay message to original sender");

            // extract sender from quote
            let contactId = message.quotedMsg.body.split('\n')[1];
            let contactNumber:number = parseInt(contactId.split('@')[0]);
            let contactType = contactId.split('@')[1];
            
            // send message
            if (contactType == "c.us") {
              client.sendText(`${contactNumber}@c.us`, `${txtMessage}`);
            } else {
              Debug.log(Debug.ERROR, "Group sending not implemented yet");  
            }
          } else {
            // process command
            Debug.log(Debug.ERROR, "Command handler not implemented yet");
          }
        } else {
          Debug.log(Debug.ERROR, `Cannot process message of type '${message.type} from self'`);
        }
      } catch (error) {
        Debug.log(Debug.ERROR, "Problem in 'onMessage' -> error", error);
      }
    } else {
      // Message not from me => forward message to other phone
      try {  
        // set message text
        if (message.type == MessageTypes.TEXT ) {
          txtMessage = message.body;
        } else {
          txtMessage = `Received message of type '${message.type}'`;
          // TODO: add caption
        }
        
        if (message.type == MessageTypes.IMAGE) {
          Debug.log(Debug.DEBUG, ">>> Send image");
          const filename = `${message.t}.${mime.extension(message.mimetype)}`;
  
          let mediaData = await decryptMedia(message, uaOverride);
          await client.sendImage(`${Config.remotePhoneNumber}@c.us`,
            `data:${message.mimetype};base64,${mediaData.toString('base64')}`,
            filename,
            `*${message.sender.formattedName}:* ${txtMessage} (${message.chat.formattedTitle})\n${message.from}`);
        } else {
          Debug.log(Debug.DEBUG, ">>> Send text");
          client.sendText(`${Config.remotePhoneNumber}@c.us`, `*${message.sender.formattedName}:* ${txtMessage} (${message.chat.formattedTitle})\n${message.from}`);
        }
      } catch (error) {
        Debug.log(Debug.ERROR, "Problem in 'onMessage' -> error", error);
      }
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
    Debug.log(Debug.ERROR, 'Error', e.message);
    // process.exit();
  });

