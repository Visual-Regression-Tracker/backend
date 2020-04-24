import { Column, Model, Table, HasMany, DataType, IsEmail } from 'sequelize-typescript';
import { BuildDto } from 'src/builds/dto/builds.dto';
import { Build } from 'src/builds/build.entity';

@Table
export class User extends Model<User> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @IsEmail
  @Column
  email: string;

  @Column
  password: string;

  @Column
  firstName: string;

  @Column
  lastName: string;

  @Column
  apiKey: string;

  @Column({ defaultValue: true })
  isActive: boolean;

  @HasMany(() => Build)
  builds: Build[];
}
