import {Table, Column, DataType, ForeignKey, Model, Index} from 'sequelize-typescript';
import {Socket} from './Socket';
import {Repo} from './Repo';

@Table({ tableName: 'socket_repo', timestamps: false })
export class SocketRepo extends Model {
  @ForeignKey(() => Socket)
  @Index
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare socketId: number;

  @ForeignKey(() => Repo)
  @Index
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare repoId: number;
}
