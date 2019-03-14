import {createClient, RedisClient} from 'redis';
import {Subscription} from "rxjs";
import {getEntityName} from "@marcj/marshal";
import {ExchangeEntity, StreamFileResult} from '@marcj/glut-core';
import {ClassType, eachPair} from '@marcj/estdlib';
import {AsyncSubscription} from '@marcj/estdlib-rxjs';
import {Injectable} from "injection-js";


type Callback<T> = (message: T) => void;

@Injectable()
export class Exchange {
    private redis: RedisClient;
    private subscriberRedis?: RedisClient;

    private subscriptions: { [channelName: string]: Callback<any>[] } = {};

    private subscribedChannelMessages = false;

    constructor(protected host: string = 'localhost', protected port: number = 6379, protected db: number = 0) {
        this.redis = createClient();
        this.redis.select(this.db);
    }

    public async disconnect() {
        await new Promise((resolve, reject) => this.redis.quit((err) => err ? reject(err) : resolve()));
        await new Promise((resolve, reject) => {
            if (this.subscriberRedis) {
                this.subscriberRedis.quit((err) => err ? reject(err) : resolve());
            } else {
                resolve();
            }
        });
    }

    public async flushDb() {
        return new Promise((resolve, reject) => this.redis.flushdb((err) => err ? reject(err) : resolve()));
    }

    public getSubscriberConnection(): RedisClient {
        if (!this.subscriberRedis) {
            this.subscriberRedis = this.redis.duplicate();
        }
        return this.subscriberRedis;
    }

    public async getSubscribedEntityFields<T>(classType: ClassType<T>): Promise<string[]> {
        const key = this.db + '/entity-field-subscription/' + getEntityName(classType);
        const fields: string[] = [];

        return new Promise<string[]>((resolve, reject) => {
            try {
                this.redis.hgetall(key, (err, keys: {[field: string]: any}) => {
                    if (err) {
                        reject(err);
                    } else {
                        for (const [i, v] of eachPair(keys)) {
                            if (parseInt(v, 10) > 0) {
                                fields.push(i);
                            }
                        }
                        resolve(fields);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    public async subscribeEntityFields<T>(classType: ClassType<T>, fields: string[]): Promise<AsyncSubscription> {
        const key = this.db + '/entity-field-subscription/' + getEntityName(classType);

        const promises: Promise<void>[] = [];
        for (const field of fields) {
            promises.push(new Promise((resolve, reject) => {
                this.redis.hincrby(key, field, 1, (err) => {
                    if (err) reject(err); else resolve();
                });
            }));
        }

        await Promise.all(promises);

        return new AsyncSubscription(async () => {
            const promises: Promise<void>[] = [];
            for (const field of fields) {
                promises.push(new Promise((resolve, reject) => {
                    this.redis.hincrby(key, field, -1, (err) => {
                        if (err) reject(err); else resolve();
                    });
                }));
            }
            await Promise.all(promises);
        });
    }

    public subscribeEntity<T>(classType: ClassType<T>, cb: Callback<ExchangeEntity>): Subscription {
        const channelName = this.db + '/entity/' + getEntityName(classType);
        return this.subscribe(channelName, cb);
    }

    public async publishEntity<T>(classType: ClassType<T>, message: ExchangeEntity) {
        const channelName = this.db + '/entity/' + getEntityName(classType);
        await this.publish(channelName, message);
    }

    public async publishFile<T>(fileId: string, message: StreamFileResult) {
        const channelName = this.db + '/file/' + fileId;
        await this.publish(channelName, message);
    }

    public subscribeFile<T>(fileId: string, cb: Callback<StreamFileResult>) {
        const channelName = this.db + '/file/' + fileId;
        return this.subscribe(channelName, cb);
    }

    public async publish(channelName: string, message: any) {
        return new Promise<void>((resolve, reject) => {
            this.redis.publish(channelName, JSON.stringify(message), (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    protected subscribeToMessages() {
        if (this.subscribedChannelMessages) {
            return;
        }

        this.subscribedChannelMessages = true;

        this.getSubscriberConnection().on('message', (messageChannel: string, message: string) => {
            const data = JSON.parse(message);

            if (this.subscriptions[messageChannel]) {
                for (const cb of this.subscriptions[messageChannel]) {
                    cb(data);
                }
            }
        });
    }

    public subscribe(channelName: string, callback: Callback<any>): Subscription {
        if (!this.subscriptions[channelName]) {
            //first time subscribes to the redis channel
            this.subscribeToMessages();

            this.subscriptions[channelName] = [];
            this.subscriptions[channelName].push(callback);
            this.getSubscriberConnection().subscribe(channelName);
        } else {
            this.subscriptions[channelName].push(callback);
        }

        return new Subscription(() => {
            const index = this.subscriptions[channelName].indexOf(callback);
            if (-1 !== index) {
                this.subscriptions[channelName].splice(index, 1);
            }

            if (this.subscriptions[channelName].length === 0) {
                this.getSubscriberConnection().unsubscribe(channelName);
                delete this.subscriptions[channelName];
            }
        });
    }
}
