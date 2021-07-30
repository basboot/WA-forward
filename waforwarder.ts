/**
 * WAForwarder
 * 
 * Class to forward Whatsapp messages to another number, and relay replies
 * back to the original sender
 */

// Import class with configuration parameters
import { Debug } from './debug';
import { Config } from './config';

// Import external packages for WA-automate and scheduling
import { create, Client, decryptMedia, ev, smartUserAgent, NotificationLanguage, MessageTypes, ChatMuteDuration } from './wa-automate-nodejs/src/index';
const mime = require('mime-types');
const uaOverride = 'WhatsApp/2.16.352 Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Safari/605.1.15';
const schedule = require('node-schedule');

// Forwarder class
export class WAForwarder {

    // Delay reconnection of client to allow using web whatsapp somewhere else for a certain period
    private readonly RECONNECT_DELAY = 10 * 60 * 1000; // ms

    // For use in and outside the class
    public static globalClient: Client;
    private client: Client;

    // Operation mode of the bot (set defaults here)
    // forward: forward incoming messages to remote phone
    // relay  : relay incoming messages from the remote phone to the original sender
    // test   : in test mode , messages from remote phone are also forwarded (back to remote phone)
    private ForwarderState = { "forward": false, "relay": false, "test": false };

    public constructor(client: Client) {
        // save for external use
        WAForwarder.globalClient = client;

        // save for internal use
        this.client = client;

        // init forwarder
        this.init();
    }

    /**
    * Format the name of the sender
    * 
    * @param sender sender object (from message or quotedMsgObj)
    * @returns formatted name and possible the pushname 
    */
    private createFormattedSenderName(sender) {
        // Set message sender
        let senderMessage = sender.formattedName;
        // When sender is not in contacts the formatted name is the phone number.
        // In this case we will append their own chosen pushname to make it easier
        // to identify.
        if (senderMessage.substr(0, 1) == "+") {
            senderMessage = `${sender.pushname} (${sender.formattedName})`
        }
        return senderMessage;
    }

    /**
     * Send forwarder state, and buttons to change the state
     * 
     * @param message status message sent with state
     */
    private sendForwarderState(message: string) {
        // create buttons with current state
        let buttons = [
            { id: `F${this.ForwarderState.forward}`, text: `forward ${this.ForwarderState.forward ? "on" : "off"}` },
            { id: `R${this.ForwarderState.relay}`, text: `relay ${this.ForwarderState.relay ? "on" : "off"}` },
            { id: `T${this.ForwarderState.test}`, text: `test ${this.ForwarderState.test ? "on" : "off"}` },
        ]

        this.client.sendButtons(`${Config.remotePhoneNumber}@c.us`, message, buttons, "Forwarder state");
    }

    private handleStateChange(state) {
        Debug.log(Debug.VERBOSE, 'statechanged', state)
        if (state === "CONFLICT" || state === "UNLAUNCHED") {
            Debug.log(Debug.VERBOSE, `Client lost session, will try to reconnect in ${this.RECONNECT_DELAY / 1000} seconds`);
            setTimeout(async () => {
                Debug.log(Debug.VERBOSE, "Trying to reconnect client now")
                await this.client.forceRefocus();
            }, this.RECONNECT_DELAY);
        }
    }

    private async handleMessageFromRemotePhone(message) {
        let txtMessage = "";
        let senderMessage = "";


        // process message from self
        try {
            if (message.type == MessageTypes.TEXT) {
                txtMessage = message.body;
                // Received a reply to forwarderd message => Relay message to original sender
                if (message.quotedMsg != null) {
                    // TODO: Check quotedMsg format
                    Debug.log(Debug.DEBUG, "Received a reply to forwarded message => Relay message to original sender");

                    // extract sender from quote
                    let contactId = message.quotedMsg.body.split('\n')[1];
                    let contactNumber: number = parseInt(contactId.split('@')[0]);
                    let contactType = contactId.split('@')[1];

                    if (this.ForwarderState.relay) {
                        Debug.log(Debug.VERBOSE, `Relaying message to ${contactId}`);
                        // send message
                        if (contactType == "c.us") {
                            Debug.log(Debug.DEBUG, "Relay to CONTACT");
                            this.client.sendText(`${contactNumber}@c.us`, `${txtMessage}`);
                        } else {
                            Debug.log(Debug.DEBUG, "Relay to GROUP");
                            let groupAndContact = contactId.split('@')[0].split('-');
                            contactNumber = parseInt(groupAndContact[0]);
                            let groupNUmber: number = parseInt(groupAndContact[1])
                            this.client.sendText(`${contactNumber}-${groupNUmber}@g.us`, `${txtMessage}`);
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
                            await this.client.sendText(`${Config.remotePhoneNumber}@c.us`, "*Forwarder exited*");
                            process.exit(0);
                            break;
                        case "ping":
                            this.sendForwarderState("Still alive");
                            return;
                            break;
                        case "forward":
                            this.ForwarderState.forward = param;
                            this.sendForwarderState("Ready");
                            return;
                            break;
                        case "relay":
                            this.ForwarderState.relay = param;
                            this.sendForwarderState("Ready");
                            return;
                            break;
                        case "test":
                            this.ForwarderState.test = param;
                            this.sendForwarderState("Ready");
                            return;
                            break;
                        default:
                            Debug.log(Debug.ERROR, `Command '${message.body}' unknown`);
                            commandResponse = `Command '${message.body}' unknown`;
                    }
                    // send response to remote phone
                    this.client.sendText(`${Config.remotePhoneNumber}@c.us`, commandResponse);

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
                            contactNumber = parseInt(vcInfo[1].replace('+', '').replace(/\s/g, ''));
                        }
                    }
                    Debug.log(Debug.DEBUG, `Send vCard for ${name} (${contactNumber})`);
                    this.client.sendText(`${Config.remotePhoneNumber}@c.us`, `*vCard:* ${name}\n${contactNumber}@c.us`);
                } else {
                    if (message.type == MessageTypes.BUTTONS_RESPONSE) {
                        Debug.log(Debug.DEBUG, "Buttons response received");

                        // TODO: cleanup and merge with chat command handling

                        // split message into command and parameter
                        let command = message.body.toLowerCase().split(' ')[0];
                        // Note that this is reversed because the buttons are used for toggling
                        let param = message.body.toLowerCase().split(' ')[1] == "off"; // only true and false
                        let commandResponse = "No response set";
                        // process command
                        switch (command) {
                            case "forward":
                                this.ForwarderState.forward = param;
                                this.sendForwarderState("Ready");
                                return;
                                break;
                            case "relay":
                                this.ForwarderState.relay = param;
                                this.sendForwarderState("Ready");
                                return;
                                break;
                            case "test":
                                this.ForwarderState.test = param;
                                this.sendForwarderState("Ready");
                                return;
                                break;
                            default:
                                Debug.log(Debug.ERROR, `Button command '${message.body}' unknown`);
                                commandResponse = `Button command '${message.body}' unknown`;
                        }
                    } else {
                        Debug.log(Debug.ERROR, `Cannot process message of type '${message.type} from self'`);
                    }
                }
            }
        } catch (error) {
            Debug.log(Debug.ERROR, "Problem in 'onMessage' -> error", error);
        }
    }

    private async handleForwardMessage(message) {
        let txtMessage = "";
        let senderMessage = "";

        try {
            // set message text
            if (message.type == MessageTypes.TEXT) {
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
                if (message.quotedMsg.type == MessageTypes.TEXT) {
                    if (message.isGroupMsg) {
                        txtMessage = `${txtMessage} _(${this.createFormattedSenderName(message.quotedMsg.sender)}: "${message.quotedMsg.body.replace(/\*|\_/gi, '')}")_`
                    } else {
                        txtMessage = `${txtMessage} _("${message.quotedMsg.body.replace(/\*|\_/gi, '')}")_`;
                    }
                } else {
                    // if quoted message is not text, just include the type
                    txtMessage = `${txtMessage} _("[${message.quotedMsg.type}]")_`;
                }
            }

            // Set message sender
            senderMessage = this.createFormattedSenderName(message.sender);

            if (this.ForwarderState.forward) {
                if (message.type == MessageTypes.IMAGE) {
                    Debug.log(Debug.DEBUG, ">>> Send image");
                    const filename = `${message.t}.${mime.extension(message.mimetype)}`;

                    let mediaData = await decryptMedia(message, uaOverride);
                    await this.client.sendImage(`${Config.remotePhoneNumber}@c.us`,
                        `data:${message.mimetype};base64,${mediaData.toString('base64')}`,
                        filename,
                        `*${senderMessage}:* ${txtMessage} (${message.chat.formattedTitle})\n${message.from}`);
                } else {
                    Debug.log(Debug.DEBUG, ">>> Send text");
                    this.client.sendText(`${Config.remotePhoneNumber}@c.us`, `*${senderMessage}:* ${txtMessage} (${message.chat.formattedTitle})\n${message.from}`);
                }
            } else {
                Debug.log(Debug.VERBOSE, `Received message '${txtMessage}' from ${senderMessage}, but forwarding is disabled`);
            }
        } catch (error) {
            Debug.log(Debug.ERROR, "Problem in 'onMessage' -> error", error);
            this.client.sendText(`${Config.remotePhoneNumber}@c.us`, "_Problem in forwarder:\n${error.message}_");
        }
    }


    private async handleMessage(message) {

        Debug.log(Debug.VERBOSE, '--- Processing new message ---')
        Debug.log(Debug.DEBUG, message);

        // check if message from remote phone 
        if (message.from == `${Config.remotePhoneNumber}@c.us`) {
            Debug.log(Debug.DEBUG, `Message from self, relay or process command`)
            this.handleMessageFromRemotePhone(message);
        } else {
            Debug.log(Debug.DEBUG, "Not from remote phone, so it is a 'normal' message");
            this.handleForwardMessage(message);
        }

        // for testing purposed also forward from remote back   
        if ((this.ForwarderState.test)) {
            Debug.log(Debug.DEBUG, "Message from self, but forward anyway because we're in test mode");
            this.handleForwardMessage(message);
        }

    }

    private async init() {
        Debug.log(Debug.VERBOSE, `Initializing WA-forwarder for: ${Config.remotePhoneNumber}`)
        const me = await this.client.getMe();
        Debug.log(Debug.INFORMATION, "start -> me", me);

        // Schedule daily message at 12:00 to inform the forwarder is running
        const job = schedule.scheduleJob('0 0 12 * * *', function () {
            Debug.log(Debug.VERBOSE, `Still alive. Sending notification.`);
            this.sendForwarderState("Still alive");
        });

        // Inform remote phone the script is active
        this.sendForwarderState("Started");

        // Register events to catch
        this.client.onAck((c: any) => Debug.log(Debug.VERBOSE, c.id, c.body, c.ack));
        this.client.onAddedToGroup(newGroup => Debug.log(Debug.VERBOSE, 'Added to new Group', newGroup.id));
        this.client.onIncomingCall(call => Debug.log(Debug.VERBOSE, 'newcall', call));
        this.client.onAnyMessage(message => { Debug.log(Debug.VERBOSE, 'Message detected of type: ', message.type) });

        this.client.onStateChanged(state => this.handleStateChange(state));
        this.client.onMessage(async message => this.handleMessage(message));
    }
}