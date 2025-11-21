import 'reflect-metadata';
import {Sequelize} from 'sequelize-typescript';
import {Peer} from '@/models/Peer';
import pg from 'pg';

let sequelize: Sequelize | null = null;

export function getSequelize(): Sequelize {
    if (sequelize) return sequelize;
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is not set');
    }
    sequelize = new Sequelize(databaseUrl, {
        dialect: 'postgres',
        dialectModule: pg,
        models: [Peer],
        logging: false,
        define: {
            timestamps: true,
            underscored: false,
        },
        dialectOptions: {
            ssl: process.env.DATABASE_URL?.includes('sslmode=require')
                ? {require: true}
                : undefined,
        },
    });
    return sequelize;
}

let synced = false;

export async function ensureDb(): Promise<Sequelize> {
    const s = getSequelize();
    if (!synced) {
        // Do not force drop; make non-destructive changes when possible
        await s.sync();
        synced = true;
    }
    return s;
}
