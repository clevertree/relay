import {Table, Model, Column, DataType, Unique, Index, BelongsToMany} from 'sequelize-typescript';
import {Socket} from './Socket';
import {SocketRepo} from './SocketRepo';

@Table({ tableName: 'repo', timestamps: true })
export class Repo extends Model {
  @Unique
  @Index
  @Column({ type: DataType.STRING, allowNull: false })
  declare name: string;

  @BelongsToMany(() => Socket, () => SocketRepo)
  declare sockets?: Array<Socket & { SocketRepo: SocketRepo }>;
}
