export class Debug {
    public static NONE:number = -1;
    public static ERROR:number = 0;
    public static WARNING:number = 1;
    public static DEBUG:number = 10;
    public static VERBOSE:number = 10;
    public static INFORMATION:number = 100;

    public static LOG_LEVEL = Debug.DEBUG;
    
    public static log(level: number, ...messages: any[]): void {
        if (level <= this.LOG_LEVEL) {
            for (let message of messages) {
                console.log(message);
            }
        }
    }
}