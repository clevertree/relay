import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import pg from 'pg';

let sequelize: Sequelize | null = null;

/**
 * Return a Sequelize instance.
 * If DATABASE_URL is set, use Postgres. Otherwise fall back to an
 * in-memory SQLite instance so Next.js prerender/build can run without
 * a database. This keeps builds stable in CI or local dev when the DB
 * isn't configured.
 */
export function getSequelize(): Sequelize {
    if (sequelize) return sequelize;
    const databaseUrl = process.env.DATABASE_URL;
        // Create the Sequelize instance without registering models yet to avoid
        // circular import/initialization issues in environments like Next.js build.
        if (databaseUrl) {
            sequelize = new Sequelize(databaseUrl, {
                dialect: 'postgres',
                dialectModule: pg,
                logging: false,
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
        } else {
            // Fallback to in-memory sqlite during build/prerender.
            sequelize = new Sequelize({
                dialect: 'sqlite',
                storage: ':memory:',
                logging: false,
                define: {
                    timestamps: true,
                    underscored: false,
                },
            } as any);
        }

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
        // Allow skipping DB init during Next.js prerender/build by setting
        // SKIP_DB_DURING_PRERENDER=1 in the build environment. This is
        // useful in CI/local builds where a DB driver or connection isn't
        // available. It's opt-in and does not change runtime behavior
        // unless the env var is explicitly set.
        if (process.env.SKIP_DB_DURING_PRERENDER === '1') {
            // mark as synced so subsequent calls are no-ops during this process
            synced = true;
            return s;
        }
            // Ensure models are registered before syncing.
            try {
                // synchronous-ish imports to register models for sequelize.
                // eslint-disable-next-line global-require
                const { Socket } = await import('@/models/Socket');
                const { Repo } = await import('@/models/Repo');
                const { SocketRepo } = await import('@/models/SocketRepo');
                const { SocketRepoBranch } = await import('@/models/SocketRepoBranch');
                s.addModels([Socket, Repo, SocketRepo, SocketRepoBranch]);
                // Apply schema changes; we intentionally break old schema and let Sequelize alter tables
                await s.sync({ alter: true });
                modelsRegistered = true;
                synced = true;
            } catch (err) {
                // If imports or sync fail, log and mark models as not registered.
                // Do not rethrow — callers will check dbModelsReady() and avoid calling model methods.
                // eslint-disable-next-line no-console
                console.warn('Failed to register models or sync DB:', err);
                modelsRegistered = false;
                synced = true; // avoid repeated attempts during the same process
                return s;
            }
    }
    return s;
}
