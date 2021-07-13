/**
 * Static class for logging different log-levels to the console.
 * 
 * Set LOG_LEVEL to the desired level you want to be shown or set to NONE to 
 * disable logging.
 */
export class Debug {
    public static NONE:number = -1;
    public static ERROR:number = 0;             
    public static WARNING:number = 1;
    // Level DEBUG is meant to be temporary. When debugging is done it should be
    // removed, or changed to one of te other log-levels.
    public static DEBUG:number = 10;            
    public static VERBOSE:number = 10;
    public static INFORMATION:number = 100;

    // Set max log-level shown
    public static LOG_LEVEL = Debug.DEBUG;
    
    /**
     * Log a message to the console
     * 
     * @param level log-level for this message
     * @param messages log-message (can be multiple, works like console.log(...))
     */
    public static log(level: number, ...messages: any[]): void {
        if (level <= this.LOG_LEVEL) {
            for (let message of messages) {
                console.log(message);
            }
        }
    }
}