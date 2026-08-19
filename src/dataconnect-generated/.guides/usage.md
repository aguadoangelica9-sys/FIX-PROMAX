# Basic Usage

Always prioritize using a supported framework over using the generated SDK
directly. Supported frameworks simplify the developer experience and help ensure
best practices are followed.





## Advanced Usage
If a user is not using a supported framework, they can use the generated SDK directly.

Here's an example of how to use it with the first 5 operations:

```js
import { createUser, updateUser, deleteUser, getUser, listUsers, createService, updateService, deleteService, getService, listServices } from '@dataconnect/generated';


// Operation CreateUser:  For variables, look at type CreateUserVars in ../index.d.ts
const { data } = await CreateUser(dataConnect, createUserVars);

// Operation UpdateUser:  For variables, look at type UpdateUserVars in ../index.d.ts
const { data } = await UpdateUser(dataConnect, updateUserVars);

// Operation DeleteUser: 
const { data } = await DeleteUser(dataConnect);

// Operation GetUser: 
const { data } = await GetUser(dataConnect);

// Operation ListUsers: 
const { data } = await ListUsers(dataConnect);

// Operation CreateService:  For variables, look at type CreateServiceVars in ../index.d.ts
const { data } = await CreateService(dataConnect, createServiceVars);

// Operation UpdateService:  For variables, look at type UpdateServiceVars in ../index.d.ts
const { data } = await UpdateService(dataConnect, updateServiceVars);

// Operation DeleteService:  For variables, look at type DeleteServiceVars in ../index.d.ts
const { data } = await DeleteService(dataConnect, deleteServiceVars);

// Operation GetService:  For variables, look at type GetServiceVars in ../index.d.ts
const { data } = await GetService(dataConnect, getServiceVars);

// Operation ListServices: 
const { data } = await ListServices(dataConnect);


```