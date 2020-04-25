import {
  Column,
  Model,
  Table,
  BelongsTo,
  ForeignKey,
  DataType,
} from 'sequelize-typescript';
import { Test } from './test.entity';

@Table
export class IgnoreArea extends Model<IgnoreArea> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column
  x: number;

  @Column
  y: number;

  @Column
  width: number;

  @Column
  height: number;

  @ForeignKey(() => Test)
  @Column({
    type: DataType.UUID,
  })
  testId: string;

  @BelongsTo(() => Test)
  test: Test;
}
