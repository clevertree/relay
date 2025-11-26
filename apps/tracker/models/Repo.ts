import {Table, Model, Column, DataType, Unique, Index} from 'sequelize-typescript';
import type { Socket } from './Socket';
import type { SocketRepo } from './SocketRepo';

@Table({ tableName: 'repo', timestamps: true })
export class Repo extends Model {
  @Unique
  @Index
  @Column({ type: DataType.STRING, allowNull: false })
  declare name: string;

  // associations are registered explicitly in ensureDb() to avoid circular import issues
  declare sockets?: Array<Socket & { SocketRepo: SocketRepo }>;
}
