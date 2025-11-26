import {Column, DataType, Index, Model, Table, Unique,} from 'sequelize-typescript';

@Table({tableName: 'peer', timestamps: true})
export class Peer extends Model {
    // @PrimaryKey
    // @AutoIncrement
    // @Column(DataType.INTEGER)
    // id!: number;

    @Unique
    @Index
    @Column({type: DataType.STRING, allowNull: false})
    socket!: string;

    @Column({type: DataType.STRING, allowNull: true})
    domain?: string;

    @Column({type: DataType.STRING, allowNull: true})
    ipv4?: string;

    @Column({type: DataType.STRING, allowNull: true})
    ipv6?: string;

    // @CreatedAt
    // @Column(DataType.DATE)
    // createdAt!: Date;
    //
    // @UpdatedAt
    // @Column(DataType.DATE)
    // updatedAt!: Date;
}
