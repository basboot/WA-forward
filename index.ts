// Import class with configuration parameters
import { Debug } from './debug';
import { Config } from './config';

import { create, Client, decryptMedia, ev, smartUserAgent, NotificationLanguage, MessageTypes, ChatMuteDuration } from './wa-automate-nodejs/src/index';
import { CLIENT_RENEG_WINDOW } from 'tls';
import { Console } from 'console';
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

// Operatiuon mode of the bot
// forward: forward incoming messages to remote phone
// relay  : relay incoming messages from the remote phone to the original sender
// test   : in test mode , messages from remote phone are also forwarded (back to remote phone)
let ForwarderState = {"forward" : true, "relay": true, "test": true};

function formattedForwarderState() {
  return`F: ${ForwarderState.forward}, R: ${ForwarderState.relay}, T: ${ForwarderState.test}`;
}

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

/**
 * Format the name of the sender
 * 
 * @param sender sender object (from message or quotedMsgObj)
 * @returns formatted name and possible the pushname 
 */
function formatSenderName(sender) {
  // Set message sender
  let senderMessage = sender.formattedName;
  // When sender is not in contacts the formatted name is the phone number.
  // In this case we will append their own chosen pushname to make it easier
  // to identify.
  if (senderMessage.substr(0,1) == "+") {
    senderMessage = `${sender.pushname}(${sender.formattedName})`
  }

  return senderMessage;
}

async function start(client: Client) {
  app.use(client.middleware(true));

  app.listen(PORT, function () {
    Debug.log(Debug.VERBOSE, `\n• Listening on port ${PORT}!`);
  });

  globalClient = client;

  Debug.log(Debug.VERBOSE, `Starting WA-forwarder for: ${Config.remotePhoneNumber}`)
  const me = await client.getMe();
  Debug.log(Debug.INFORMATION, "start -> me", me);

  // inform remote phone the script is active
  client.sendText(`${Config.remotePhoneNumber}@c.us`, `*Forwarder started*\n${formattedForwarderState()}`);

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
    let senderMessage = "";

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
            
            if (ForwarderState.relay) {
              Debug.log(Debug.VERBOSE, `Relaying message to ${contactId}`);
              // send message
              if (contactType == "c.us") {
                Debug.log(Debug.DEBUG, "Relay to CONTACT");
                client.sendText(`${contactNumber}@c.us`, `${txtMessage}`);
              } else {
                Debug.log(Debug.DEBUG, "Relay to GROUP");
                let groupAndContact = contactId.split('@')[0].split('-');
                contactNumber = parseInt(groupAndContact[0]);
                let groupNUmber:number = parseInt(groupAndContact[1])
                client.sendText(`${contactNumber}-${groupNUmber}@g.us`, `${txtMessage}`);
              }
            } else {
              Debug.log(Debug.VERBOSE, `Received relaying message for ${contactId}, but relaying is disabled`);
            }            
          } else {
            // split message into command and parameter
            let command = message.body.toLowerCase().split(' ')[0];
            let param = message.body.toLowerCase().split(' ')[1] == "1"; // only true and false
            let commandResponse = "No response set";
            // process command
            switch (command) {
              case "exit":
                Debug.log(Debug.WARNING, "Exit script on user request")
                // TODO: also send this message on user interrupt
                await client.sendText(`${Config.remotePhoneNumber}@c.us`, "*Forwarder exited*");
                process.exit(0);
                break;
              case "ping":
                commandResponse = `${formattedForwarderState()} _(still alive)_`;
                break;
              case "forward":
                ForwarderState.forward = param;
                commandResponse = `${formattedForwarderState()}`;
                break;
              case "relay":
                ForwarderState.relay = param;
                commandResponse = `${formattedForwarderState()}`;
                break;
              case "test":
                ForwarderState.test = param;
                commandResponse = `${formattedForwarderState()}`;
                break;
              default:
                Debug.log(Debug.ERROR, `Command '${message.body}' unknown`);
                commandResponse = `Command '${message.body}' unknown`;
            }
            // send response to remote phone
            client.sendText(`${Config.remotePhoneNumber}@c.us`, commandResponse);
            
          }
        } else {
          if (message.type == MessageTypes.CONTACT_CARD) {
            Debug.log(Debug.DEBUG, "Received a VCARD");

            // Vcard version 3.0 syntax
            // PROPERTY[;PARAMETER]:attribute[;attribute]
            Debug.log(Debug.DEBUG, message.content);
            let lines = message.content.split('\n');
            let name = "Name not found";
            let contactNumber = -1;
            for (let line of lines) {
              // split into property+param and attribute
              let vcInfo = line.split(':');
              // use formatted name as name 
              if (vcInfo[0] == "FN") {
                name = vcInfo[1];
              }

              // split into property and param
              let vcProperty = vcInfo[0].split(';');
              // just use first phone number (for now)
              if (vcProperty[0] == "item1.TEL") {
                // remove + sign before, and space inbetween digits to convert to number
                Debug.log(Debug.DEBUG, `TEL found, extra number from: ${vcInfo[1]}`);
                contactNumber = parseInt(vcInfo[1].replace('+','').replace(/\s/g, ''));
              }
            }
            Debug.log(Debug.DEBUG, `Send vCard for ${name} (${contactNumber})`);
            client.sendText(`${Config.remotePhoneNumber}@c.us`, `*vCard:* ${name}\n${contactNumber}@c.us`);
            
          } else {
            Debug.log(Debug.ERROR, `Cannot process message of type '${message.type} from self'`);
          }
        }
      } catch (error) {
        Debug.log(Debug.ERROR, "Problem in 'onMessage' -> error", error);
      }
    } 
    // Not splitted into if/else, to allow forwarding messages from self for testing

    // Message not from me (or in test mode) => forward message to other phone
    if ((!messageFromMe) || (ForwarderState.test)) {
      try {  
        // set message text
        if (message.type == MessageTypes.TEXT ) {
          txtMessage = message.body;
        } else {
          txtMessage = `Received message of type '${message.type}'`;
        }
        if (message.type == MessageTypes.IMAGE) {
          // TODO: add caption for other types?
          // Put caption instead of type-image if available 
          if ("caption" in message) {
            txtMessage = message.caption;
          }
        }
        // add quoted message if the message is a reply
        if (message.quotedMsg != null) {
          // also add writer of the quoted message for group messages
          if (message.isGroupMsg) {
            txtMessage = `${txtMessage} _(${formatSenderName(message.quotedMsg.sender)}: "${message.quotedMsg.body}")_`
          } else {
            txtMessage = `${txtMessage} _("${message.quotedMsg.body}")_`;
          }
        }
        
        // Set message sender
        senderMessage = formatSenderName(message.sender);

        if (ForwarderState.forward) {
          if (message.type == MessageTypes.IMAGE) {
            Debug.log(Debug.DEBUG, ">>> Send image");
            const filename = `${message.t}.${mime.extension(message.mimetype)}`;
    
            let mediaData = await decryptMedia(message, uaOverride);
            await client.sendImage(`${Config.remotePhoneNumber}@c.us`,
              `data:${message.mimetype};base64,${mediaData.toString('base64')}`,
              filename,
              `*${senderMessage}:* ${txtMessage} (${message.chat.formattedTitle})\n${message.from}`);
          } else {
            Debug.log(Debug.DEBUG, ">>> Send text");
            client.sendText(`${Config.remotePhoneNumber}@c.us`, `*${senderMessage}:* ${txtMessage} (${message.chat.formattedTitle})\n${message.from}`);
          }
        } else {
          Debug.log(Debug.VERBOSE, `Received message '${txtMessage}' from ${senderMessage}, but forwarding is disabled`);
        }
      } catch (error) {
        Debug.log(Debug.ERROR, "Problem in 'onMessage' -> error", error);
        client.sendText(`${Config.remotePhoneNumber}@c.us`, "_Problem in forwarder:\n${error.message}_");
      }
    }
  });
}

// TODO: Fix this, it is not working
// Begin reading from stdin so the process does not exit.
process.stdin.resume();
process.on('SIGINT', function() {
  Debug.log(Debug.VERBOSE, "WA-Forwarder interrupted by user")
  if (globalClient !== undefined) {
    async () => {
      await globalClient.sendText(`${Config.remotePhoneNumber}@c.us`, "*Forwarder interrupted by user*");
      process.exit();
    }
  } else {
    process.exit();
  }
  
});

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
    if (globalClient !== undefined) {
      async () => await globalClient.sendText(`${Config.remotePhoneNumber}@c.us`, "*Forwarder crashed*\n${e.message}");
    }
  });

    
