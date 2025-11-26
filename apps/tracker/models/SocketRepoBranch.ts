import {Table, Column, DataType, ForeignKey, Model, Index} from 'sequelize-typescript';
import {Socket} from './Socket';
import {Repo} from './Repo';

@Table({ tableName: 'socket_repo_branch', timestamps: true })
export class SocketRepoBranch extends Model {
  @ForeignKey(() => Socket)
  @Index
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare socketId: number;

  @ForeignKey(() => Repo)
  @Index
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare repoId: number;

  @Index
  @Column({ type: DataType.STRING, allowNull: false })
  declare branch: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare commit: string;
}
