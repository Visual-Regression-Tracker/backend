import { Column, Model, Table, HasMany, DataType } from 'sequelize-typescript';
import { Build } from 'src/builds/build.entity';

@Table
export class Project extends Model<Project> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column
  name: string;

  @HasMany(() => Build)
  builds: Build[];
}
