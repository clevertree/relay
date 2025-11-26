import {Table, Model, Column, DataType, Unique, Index} from 'sequelize-typescript';
import type { Repo } from './Repo';
import type { SocketRepo } from './SocketRepo';

@Table({ tableName: 'socket', timestamps: true })
export class Socket extends Model {
  @Unique
  @Index
  @Column({ type: DataType.STRING, allowNull: false })
  declare socket: string;

  // associations are registered explicitly in ensureDb() to avoid circular import issues
  declare repos?: Array<Repo & { SocketRepo: SocketRepo }>;
}
