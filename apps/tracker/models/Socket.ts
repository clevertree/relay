import {Table, Model, Column, DataType, Unique, Index, BelongsToMany} from 'sequelize-typescript';
import {Repo} from './Repo';
import {SocketRepo} from './SocketRepo';

@Table({ tableName: 'socket', timestamps: true })
export class Socket extends Model {
  @Unique
  @Index
  @Column({ type: DataType.STRING, allowNull: false })
  declare socket: string;

  @BelongsToMany(() => Repo, () => SocketRepo)
  declare repos?: Array<Repo & { SocketRepo: SocketRepo }>;
}
