import { Column, Model, Table, HasMany } from 'sequelize-typescript';
import { BuildDto } from 'src/builds/dto/builds.dto';
import { Build } from 'src/builds/build.entity';

@Table
export class User extends Model<User> {
  @Column
  email: string;

  @Column
  password: string;

  @Column
  firstName: string;

  @Column
  lastName: string;

  @Column({ defaultValue: true })
  isActive: boolean;

  @HasMany(() => Build)
  builds: Build[];
}
