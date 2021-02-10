import { ConsoleTransport, Logger, LoggerInterface, TimestampFormatter } from '@deepkit/logger';

export class DatabaseLogger {
    protected logger?: LoggerInterface;

    public active: boolean = false;
    public: boolean = false;

    enableLogging(): void {
        if (!this.logger) this.logger = new Logger([new ConsoleTransport], [new TimestampFormatter]);
        this.active = true;
    }

    setLogger(logger: LoggerInterface) {
        this.logger = logger;
    }

    logQuery(query: string, params: any[]) {
        if (!this.active || !this.logger) return;

        this.logger.scoped('deepkit/orm').log(query.trim(), params);
    }
}