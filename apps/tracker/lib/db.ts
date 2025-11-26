import 'reflect-metadata';
import {Sequelize} from 'sequelize-typescript';
import {Socket} from '@/models/Socket';
import {Repo} from '@/models/Repo';
import {SocketRepo} from '@/models/SocketRepo';
import {SocketRepoBranch} from '@/models/SocketRepoBranch';
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
        models: [Socket, Repo, SocketRepo, SocketRepoBranch],
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
        // Apply schema changes; we intentionally break old schema and let Sequelize alter tables
        await s.sync({ alter: true });
        synced = true;
    }
    return s;
}
