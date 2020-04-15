import { Column, Model, Table, HasMany } from 'sequelize-typescript';
import { Build } from 'src/builds/build.model';

@Table
export class Project extends Model<Project> {
  @Column
  name: string;

  @HasMany(() => Build)
  builds: Build[];
}
