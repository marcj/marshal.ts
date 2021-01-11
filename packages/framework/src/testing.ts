import { BrokerKernel } from "@deepkit/broker";
import { ClassType } from "@deepkit/core";
import { Database, MemoryDatabaseAdapter } from "@deepkit/orm";
import { ClassSchema, entity } from "@deepkit/type";
import { Application } from "./application";
import { ApplicationServer } from "./application-server";
import { Broker, BrokerServer, DirectBroker } from "./broker/broker";
import { DatabaseRegistry } from "./database-registry";
import { injectorReference } from "./injector/injector";
import { Provider } from "./injector/provider";
import { ConsoleTransport, Logger, LoggerLevel, LoggerTransport } from "./logger";
import { createModule, Module, ModuleOptions } from "./module";
import { WebMemoryWorkerFactory, WebWorkerFactory } from "./worker";


export class TestingFascade<A extends Application<any>> {
    constructor(public app: A) { }

    public async startServer() {
        await this.app.get(ApplicationServer).start();
    }

    public async request(method: string, path: string, body?: any) {

    }

    public createRpcClient() {
        return this.app.get(ApplicationServer).createClient();
    }
}

export class BrokerMemoryServer extends BrokerServer {
    public kernel = new BrokerKernel();

    async start() {
    }

    async stop() {
    }
}

export class MemoryLoggerTransport implements LoggerTransport {
    public messages: {level: LoggerLevel, message: string}[] = [];
    public messageStrings: string[] = [];

    write(message: string, level: LoggerLevel) {
        this.messages.push({level, message});
        this.messageStrings.push(message);
    }

    supportsColor() {
        return false;
    }
}

/** 
 * Creates a new Application instance, but with kernel services in place that work in memory.
 * For example RPC/Broker/HTTP communication without TCP stack. Logger uses MemoryLogger.
*/
export function createTestingApp<O extends ModuleOptions<NAME>, NAME extends string>(optionsOrModule: (O & { name?: NAME } | Module<O>), entities?: (ClassType | ClassSchema)[]): TestingFascade<Application<O>> {
    const module = optionsOrModule instanceof Module ? optionsOrModule : createModule(optionsOrModule);

    module.setupProvider(Logger).removeTransport(injectorReference(ConsoleTransport));
    module.setupProvider(Logger).addTransport(injectorReference(MemoryLoggerTransport));

    const providers: Provider[] = [
        { provide: WebWorkerFactory, useClass: WebMemoryWorkerFactory }, //don't start HTTP-server
        { provide: BrokerServer, useClass: BrokerMemoryServer }, //don't start Broker TCP-server
        MemoryLoggerTransport,
        {
            provide: Broker, deps: [BrokerServer], useFactory: (server: BrokerMemoryServer) => {
                return new DirectBroker(server.kernel);
            }
        },
    ];

    if (entities) {
        providers.push({provide: Database, useValue: new Database(new MemoryDatabaseAdapter, entities)})
        module.setupProvider(DatabaseRegistry).addDatabase(Database);
    }

    return new TestingFascade(new Application(module, providers));
}