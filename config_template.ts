// Set correct phone number
// Save file as 'config.ts'

// Static class with configuration parameters for WA-forward

import { start } from './index';
import { NotificationLanguage } from './wa-automate-nodejs/src/index';


export class Config {
    // phone number including country code (eg. 31 for NL), but without a +
    public static remotePhoneNumber: number = 31000000000;

    // default forwarder state
    public static ForwarderState = { "forward": false, "relay": false, "test": false }

    public static clientConfig = {
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
      }
}



