import {
  Column,
  Model,
  Table,
  BelongsTo,
  ForeignKey,
  Unique,
} from 'sequelize-typescript';
import { Build } from 'src/builds/build.entity';

@Table
export class Test extends Model<Test> {
  @Column
  name: string;

  @Column
  baselineUrl: string;

  @Column
  imageUrl: string;

  @Column
  diffUrl: string;

  @Column
  os: string;

  @Column
  browser: string;

  @Column
  viewport: string;

  @Column
  device: string;

  @Column
  status: string;

  @Column
  pixelMisMatchCount: number;

  @ForeignKey(() => Build)
  @Column
  buildId: number;

  @BelongsTo(() => Build)
  build: Build;
}
