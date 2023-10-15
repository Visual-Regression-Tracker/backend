import { User } from '@prisma/client';
import axios from 'axios';
import { ProjectDto } from 'src/projects/dto/project.dto';
import { UserLoginRequestDto } from 'src/users/dto/user-login-request.dto';
import { UserLoginResponseDto } from 'src/users/dto/user-login-response.dto';
import uuidAPIKey from 'uuid-apikey';

axios.defaults.baseURL = 'http://localhost:4200';

const user: Partial<User> = {
  email: `${uuidAPIKey.create().uuid}@example.com`,
  password: '123456',
  firstName: 'fName',
  lastName: 'lName',
};
const loginData: UserLoginRequestDto = {
  email: user.email,
  password: user.password,
};

describe('Acceptance', () => {
  test('Register and login', async () => {
    await axios.post<User>('/users/register', user);

    const response = await axios.post<UserLoginResponseDto>('/users/login', loginData);

    expect(response.status).toBe(201);
    expect(response.data.token).toBeDefined();
  });

  test('Health Check', async () => {
    const url = '/health';
  });

  test('User Registration', async () => {
    const url = '/users/register';
  });

  test('User Login', async () => {
    const url = '/users/login';
  });

  test('Generate New API Key for User', async () => {
    const url = '/users/newApiKey';
  });

  test('Change User Password', async () => {
    const url = '/users/password';
  });

  test('Update User Information', async () => {
    const url = '/users';
    // axios.put();
  });

  test('Delete User', async () => {
    const url = '/users';
    // axios.delete();
  });

  test('Get List of All Users', async () => {
    const url = '/users/all';
  });

  test('Assign Role to User', async () => {
    const url = '/users/assignRole';
    // axios.patch();
  });

  test('Get List of Builds', async () => {
    const url = '/builds';
  });

  test('Create a Build', async () => {
    const url = '/builds';
    // axios.post();
  });

  test('Get Build Details', async () => {
    const url = '/builds/{id}';
  });

  test('Remove a Build', async () => {
    const url = '/builds/{id}';
    // axios.delete();
  });

  test('Update Build Information', async () => {
    const url = '/builds/{id}';
    // axios.patch();
  });

  test('Approve a Build', async () => {
    const url = '/builds/{id}/approve';
    // axios.patch();
  });

  test('Get List of Test Variations', async () => {
    const url = '/test-variations';
  });

  test('Get Test Variation Details', async () => {
    const url = '/test-variations/details/{id}';
  });

  test('Merge Test Variations', async () => {
    const url = '/test-variations/merge';
  });

  test('Delete Test Variation', async () => {
    const url = '/test-variations/{id}';
    // axios.delete();
  });

  test('Get List of Test Runs', async () => {
    const url = '/test-runs';
  });

  test('Create a Test Run', async () => {
    const url = '/test-runs';
    // axios.post();
  });

  test('Get Test Run Details', async () => {
    const url = '/test-runs/{id}';
  });

  test('Approve a Test Run', async () => {
    const url = '/test-runs/approve';
    // axios.post();
  });

  test('Reject a Test Run', async () => {
    const url = '/test-runs/reject';
    // axios.post();
  });

  test('Delete a Test Run', async () => {
    const url = '/test-runs/delete';
    // axios.post();
  });

  test('Update Ignore Areas for a Test Run', async () => {
    const url = '/test-runs/ignoreAreas/update';
    // axios.post();
  });

  test('Add Ignore Areas to a Test Run', async () => {
    const url = '/test-runs/ignoreAreas/add';
    // axios.post();
  });

  test('Update a Test Run', async () => {
    const url = '/test-runs/update/{testRunId}';
    // axios.patch();
  });

  test('Create a Test Run with Multipart Data', async () => {
    const url = '/test-runs/multipart';
    // axios.post();
  });

  test('Get List of Projects', async () => {
    const url = '/projects';
    const response = await axios.get<ProjectDto[]>(url);
    
    expect(response.status).toBe(401); // Not authorized
  });

  test('Create a Project', async () => {
    const url = '/projects';
    // axios.post();
  });

  test('Remove a Project', async () => {
    const url = '/projects/{id}';
    // axios.delete();
  });
});
