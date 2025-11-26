import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import pg from 'pg';

let sequelize: Sequelize | null = null;

/**
 * Return a Sequelize instance.
 * If DATABASE_URL is set, use Postgres. Otherwise use an
 * in-memory SQLite instance. DB must be available during render.
 */
export function getSequelize(): Sequelize {
    if (sequelize) return sequelize;
    const databaseUrl = process.env.DATABASE_URL;
    if(!databaseUrl)
        throw new Error('DATABASE_URL is not set');
        // Create the Sequelize instance without registering models yet to avoid
        // circular import/initialization issues in environments like Next.js build.
            sequelize = new Sequelize(databaseUrl, {
                dialect: 'postgres',
                dialectModule: pg,
                logging: true,
                define: {
                    timestamps: true,
                    underscored: false,
                },
                dialectOptions: {
                    ssl: process.env.DATABASE_URL?.includes('sslmode=require')
                        ? { require: true }
                        : undefined,
                },
            });
            sequelize.sync({ alter: process.env.RELAY_DB_ALTER === 'true' });

            // Models will be registered later in ensureDb() to avoid import side-effects
            // during module initialization (which can happen during Next.js build).
    return sequelize;
}

let synced = false;
let modelsRegistered = false;

export function dbModelsReady(): boolean {
    return modelsRegistered;
}

export async function ensureDb(): Promise<Sequelize> {
    const s = getSequelize();
    if (!synced) {
            // Ensure models are registered before syncing.
            try {
                // synchronous-ish imports to register models for sequelize.
                // eslint-disable-next-line global-require
                const { Peer } = await import('@/models/Peer');
                const { Socket } = await import('@/models/Socket');
                const { Repo } = await import('@/models/Repo');
                const { SocketRepo } = await import('@/models/SocketRepo');
                const { SocketRepoBranch } = await import('@/models/SocketRepoBranch');
                // Register Peer as well so code can call Peer.findAll() safely.
                s.addModels([Peer, Socket, Repo, SocketRepo, SocketRepoBranch]);
                // Explicitly register associations after models are added to avoid
                // running decorator association code at module import time which
                // can trigger circular import/init ordering issues.
                try {
                    // Some models use type-only imports; call association helpers here.
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const S: any = Socket;
                    const R: any = Repo;
                    const SR: any = SocketRepo;
                    if (S && R && SR && typeof S.belongsToMany === 'function') {
                        S.belongsToMany(R, { through: SR });
                    }
                    if (R && S && SR && typeof R.belongsToMany === 'function') {
                        R.belongsToMany(S, { through: SR });
                    }
                } catch (e) {
                    // If explicit association registration fails, rethrow to surface during render/build.
                    throw e;
                }
                // Apply schema changes; we intentionally break old schema and let Sequelize alter tables
                await s.sync({ alter: true });
                modelsRegistered = true;
                synced = true;
            } catch (err) {
                // If imports or sync fail, error out as DB must be available during render.
                throw err;
            }
    }
    return s;
}
