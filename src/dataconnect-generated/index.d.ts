import { ConnectorConfig, DataConnect, QueryRef, QueryPromise, ExecuteQueryOptions, MutationRef, MutationPromise, DataConnectSettings } from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;
export const dataConnectSettings: DataConnectSettings;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;




export interface Availability_Key {
  id: UUIDString;
  __typename?: 'Availability_Key';
}

export interface CreateAvailabilityData {
  availability_insert: Availability_Key;
}

export interface CreateAvailabilityVariables {
  startTime: TimestampString;
  endTime: TimestampString;
}

export interface CreateProjectData {
  project_insert: Project_Key;
}

export interface CreateProjectVariables {
  description: string;
  status: string;
  totalCost: number;
  proId: UUIDString;
  serviceId: UUIDString;
}

export interface CreateReviewData {
  review_insert: Review_Key;
}

export interface CreateReviewVariables {
  rating: number;
  comment: string;
  projectId: UUIDString;
  proId: UUIDString;
}

export interface CreateServiceData {
  service_insert: Service_Key;
}

export interface CreateServiceVariables {
  name: string;
  category: string;
}

export interface CreateUserData {
  user_insert: User_Key;
}

export interface CreateUserVariables {
  name: string;
  email: string;
  role: string;
}

export interface DeleteAvailabilityData {
  availability_delete?: Availability_Key | null;
}

export interface DeleteAvailabilityVariables {
  id: UUIDString;
}

export interface DeleteProjectData {
  project_delete?: Project_Key | null;
}

export interface DeleteProjectVariables {
  id: UUIDString;
}

export interface DeleteReviewData {
  review_delete?: Review_Key | null;
}

export interface DeleteReviewVariables {
  id: UUIDString;
}

export interface DeleteServiceData {
  service_delete?: Service_Key | null;
}

export interface DeleteServiceVariables {
  id: UUIDString;
}

export interface DeleteUserData {
  user_delete?: User_Key | null;
}

export interface GetAvailabilityData {
  availability?: {
    startTime: TimestampString;
    endTime: TimestampString;
    pro: {
      name: string;
    };
  };
}

export interface GetAvailabilityVariables {
  id: UUIDString;
}

export interface GetProjectData {
  project?: {
    description: string;
    status: string;
    totalCost: number;
    homeowner: {
      name: string;
    };
    pro: {
      name: string;
    };
    service: {
      name: string;
    };
  };
}

export interface GetProjectVariables {
  id: UUIDString;
}

export interface GetReviewData {
  review?: {
    rating: number;
    comment: string;
    project: {
      description: string;
    };
  };
}

export interface GetReviewVariables {
  id: UUIDString;
}

export interface GetServiceData {
  service?: {
    name: string;
    category: string;
  };
}

export interface GetServiceVariables {
  id: UUIDString;
}

export interface GetUserData {
  user?: {
    name: string;
    email: string;
    role: string;
    phoneNumber?: string | null;
    profilePictureUrl?: string | null;
  };
}

export interface ListAvailabilitiesData {
  availabilities: ({
    startTime: TimestampString;
    endTime: TimestampString;
    pro: {
      name: string;
    };
  })[];
}

export interface ListMyProjectsData {
  projects: ({
    description: string;
    status: string;
    totalCost: number;
  })[];
}

export interface ListReviewsData {
  reviews: ({
    rating: number;
    comment: string;
  })[];
}

export interface ListServicesData {
  services: ({
    name: string;
    category: string;
  })[];
}

export interface ListUsersData {
  users: ({
    name: string;
    role: string;
  })[];
}

export interface Project_Key {
  id: UUIDString;
  __typename?: 'Project_Key';
}

export interface Review_Key {
  id: UUIDString;
  __typename?: 'Review_Key';
}

export interface Service_Key {
  id: UUIDString;
  __typename?: 'Service_Key';
}

export interface UpdateAvailabilityData {
  availability_update?: Availability_Key | null;
}

export interface UpdateAvailabilityVariables {
  id: UUIDString;
  startTime?: TimestampString | null;
}

export interface UpdateProjectData {
  project_update?: Project_Key | null;
}

export interface UpdateProjectVariables {
  id: UUIDString;
  status?: string | null;
}

export interface UpdateReviewData {
  review_update?: Review_Key | null;
}

export interface UpdateReviewVariables {
  id: UUIDString;
  comment?: string | null;
}

export interface UpdateServiceData {
  service_update?: Service_Key | null;
}

export interface UpdateServiceVariables {
  id: UUIDString;
  name?: string | null;
}

export interface UpdateUserData {
  user_update?: User_Key | null;
}

export interface UpdateUserVariables {
  name?: string | null;
}

export interface User_Key {
  id: UUIDString;
  __typename?: 'User_Key';
}

interface CreateUserRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateUserVariables): MutationRef<CreateUserData, CreateUserVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateUserVariables): MutationRef<CreateUserData, CreateUserVariables>;
  operationName: string;
}
export const createUserRef: CreateUserRef;

export function createUser(vars: CreateUserVariables): MutationPromise<CreateUserData, CreateUserVariables>;
export function createUser(dc: DataConnect, vars: CreateUserVariables): MutationPromise<CreateUserData, CreateUserVariables>;

interface UpdateUserRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars?: UpdateUserVariables): MutationRef<UpdateUserData, UpdateUserVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars?: UpdateUserVariables): MutationRef<UpdateUserData, UpdateUserVariables>;
  operationName: string;
}
export const updateUserRef: UpdateUserRef;

export function updateUser(vars?: UpdateUserVariables): MutationPromise<UpdateUserData, UpdateUserVariables>;
export function updateUser(dc: DataConnect, vars?: UpdateUserVariables): MutationPromise<UpdateUserData, UpdateUserVariables>;

interface DeleteUserRef {
  /* Allow users to create refs without passing in DataConnect */
  (): MutationRef<DeleteUserData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): MutationRef<DeleteUserData, undefined>;
  operationName: string;
}
export const deleteUserRef: DeleteUserRef;

export function deleteUser(): MutationPromise<DeleteUserData, undefined>;
export function deleteUser(dc: DataConnect): MutationPromise<DeleteUserData, undefined>;

interface GetUserRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<GetUserData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<GetUserData, undefined>;
  operationName: string;
}
export const getUserRef: GetUserRef;

export function getUser(options?: ExecuteQueryOptions): QueryPromise<GetUserData, undefined>;
export function getUser(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<GetUserData, undefined>;

interface ListUsersRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListUsersData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListUsersData, undefined>;
  operationName: string;
}
export const listUsersRef: ListUsersRef;

export function listUsers(options?: ExecuteQueryOptions): QueryPromise<ListUsersData, undefined>;
export function listUsers(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<ListUsersData, undefined>;

interface CreateServiceRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateServiceVariables): MutationRef<CreateServiceData, CreateServiceVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateServiceVariables): MutationRef<CreateServiceData, CreateServiceVariables>;
  operationName: string;
}
export const createServiceRef: CreateServiceRef;

export function createService(vars: CreateServiceVariables): MutationPromise<CreateServiceData, CreateServiceVariables>;
export function createService(dc: DataConnect, vars: CreateServiceVariables): MutationPromise<CreateServiceData, CreateServiceVariables>;

interface UpdateServiceRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateServiceVariables): MutationRef<UpdateServiceData, UpdateServiceVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdateServiceVariables): MutationRef<UpdateServiceData, UpdateServiceVariables>;
  operationName: string;
}
export const updateServiceRef: UpdateServiceRef;

export function updateService(vars: UpdateServiceVariables): MutationPromise<UpdateServiceData, UpdateServiceVariables>;
export function updateService(dc: DataConnect, vars: UpdateServiceVariables): MutationPromise<UpdateServiceData, UpdateServiceVariables>;

interface DeleteServiceRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: DeleteServiceVariables): MutationRef<DeleteServiceData, DeleteServiceVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: DeleteServiceVariables): MutationRef<DeleteServiceData, DeleteServiceVariables>;
  operationName: string;
}
export const deleteServiceRef: DeleteServiceRef;

export function deleteService(vars: DeleteServiceVariables): MutationPromise<DeleteServiceData, DeleteServiceVariables>;
export function deleteService(dc: DataConnect, vars: DeleteServiceVariables): MutationPromise<DeleteServiceData, DeleteServiceVariables>;

interface GetServiceRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetServiceVariables): QueryRef<GetServiceData, GetServiceVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetServiceVariables): QueryRef<GetServiceData, GetServiceVariables>;
  operationName: string;
}
export const getServiceRef: GetServiceRef;

export function getService(vars: GetServiceVariables, options?: ExecuteQueryOptions): QueryPromise<GetServiceData, GetServiceVariables>;
export function getService(dc: DataConnect, vars: GetServiceVariables, options?: ExecuteQueryOptions): QueryPromise<GetServiceData, GetServiceVariables>;

interface ListServicesRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListServicesData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListServicesData, undefined>;
  operationName: string;
}
export const listServicesRef: ListServicesRef;

export function listServices(options?: ExecuteQueryOptions): QueryPromise<ListServicesData, undefined>;
export function listServices(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<ListServicesData, undefined>;

interface CreateProjectRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateProjectVariables): MutationRef<CreateProjectData, CreateProjectVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateProjectVariables): MutationRef<CreateProjectData, CreateProjectVariables>;
  operationName: string;
}
export const createProjectRef: CreateProjectRef;

export function createProject(vars: CreateProjectVariables): MutationPromise<CreateProjectData, CreateProjectVariables>;
export function createProject(dc: DataConnect, vars: CreateProjectVariables): MutationPromise<CreateProjectData, CreateProjectVariables>;

interface UpdateProjectRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateProjectVariables): MutationRef<UpdateProjectData, UpdateProjectVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdateProjectVariables): MutationRef<UpdateProjectData, UpdateProjectVariables>;
  operationName: string;
}
export const updateProjectRef: UpdateProjectRef;

export function updateProject(vars: UpdateProjectVariables): MutationPromise<UpdateProjectData, UpdateProjectVariables>;
export function updateProject(dc: DataConnect, vars: UpdateProjectVariables): MutationPromise<UpdateProjectData, UpdateProjectVariables>;

interface DeleteProjectRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: DeleteProjectVariables): MutationRef<DeleteProjectData, DeleteProjectVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: DeleteProjectVariables): MutationRef<DeleteProjectData, DeleteProjectVariables>;
  operationName: string;
}
export const deleteProjectRef: DeleteProjectRef;

export function deleteProject(vars: DeleteProjectVariables): MutationPromise<DeleteProjectData, DeleteProjectVariables>;
export function deleteProject(dc: DataConnect, vars: DeleteProjectVariables): MutationPromise<DeleteProjectData, DeleteProjectVariables>;

interface GetProjectRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetProjectVariables): QueryRef<GetProjectData, GetProjectVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetProjectVariables): QueryRef<GetProjectData, GetProjectVariables>;
  operationName: string;
}
export const getProjectRef: GetProjectRef;

export function getProject(vars: GetProjectVariables, options?: ExecuteQueryOptions): QueryPromise<GetProjectData, GetProjectVariables>;
export function getProject(dc: DataConnect, vars: GetProjectVariables, options?: ExecuteQueryOptions): QueryPromise<GetProjectData, GetProjectVariables>;

interface ListMyProjectsRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListMyProjectsData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListMyProjectsData, undefined>;
  operationName: string;
}
export const listMyProjectsRef: ListMyProjectsRef;

export function listMyProjects(options?: ExecuteQueryOptions): QueryPromise<ListMyProjectsData, undefined>;
export function listMyProjects(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<ListMyProjectsData, undefined>;

interface CreateReviewRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateReviewVariables): MutationRef<CreateReviewData, CreateReviewVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateReviewVariables): MutationRef<CreateReviewData, CreateReviewVariables>;
  operationName: string;
}
export const createReviewRef: CreateReviewRef;

export function createReview(vars: CreateReviewVariables): MutationPromise<CreateReviewData, CreateReviewVariables>;
export function createReview(dc: DataConnect, vars: CreateReviewVariables): MutationPromise<CreateReviewData, CreateReviewVariables>;

interface UpdateReviewRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateReviewVariables): MutationRef<UpdateReviewData, UpdateReviewVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdateReviewVariables): MutationRef<UpdateReviewData, UpdateReviewVariables>;
  operationName: string;
}
export const updateReviewRef: UpdateReviewRef;

export function updateReview(vars: UpdateReviewVariables): MutationPromise<UpdateReviewData, UpdateReviewVariables>;
export function updateReview(dc: DataConnect, vars: UpdateReviewVariables): MutationPromise<UpdateReviewData, UpdateReviewVariables>;

interface DeleteReviewRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: DeleteReviewVariables): MutationRef<DeleteReviewData, DeleteReviewVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: DeleteReviewVariables): MutationRef<DeleteReviewData, DeleteReviewVariables>;
  operationName: string;
}
export const deleteReviewRef: DeleteReviewRef;

export function deleteReview(vars: DeleteReviewVariables): MutationPromise<DeleteReviewData, DeleteReviewVariables>;
export function deleteReview(dc: DataConnect, vars: DeleteReviewVariables): MutationPromise<DeleteReviewData, DeleteReviewVariables>;

interface GetReviewRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetReviewVariables): QueryRef<GetReviewData, GetReviewVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetReviewVariables): QueryRef<GetReviewData, GetReviewVariables>;
  operationName: string;
}
export const getReviewRef: GetReviewRef;

export function getReview(vars: GetReviewVariables, options?: ExecuteQueryOptions): QueryPromise<GetReviewData, GetReviewVariables>;
export function getReview(dc: DataConnect, vars: GetReviewVariables, options?: ExecuteQueryOptions): QueryPromise<GetReviewData, GetReviewVariables>;

interface ListReviewsRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListReviewsData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListReviewsData, undefined>;
  operationName: string;
}
export const listReviewsRef: ListReviewsRef;

export function listReviews(options?: ExecuteQueryOptions): QueryPromise<ListReviewsData, undefined>;
export function listReviews(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<ListReviewsData, undefined>;

interface CreateAvailabilityRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateAvailabilityVariables): MutationRef<CreateAvailabilityData, CreateAvailabilityVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateAvailabilityVariables): MutationRef<CreateAvailabilityData, CreateAvailabilityVariables>;
  operationName: string;
}
export const createAvailabilityRef: CreateAvailabilityRef;

export function createAvailability(vars: CreateAvailabilityVariables): MutationPromise<CreateAvailabilityData, CreateAvailabilityVariables>;
export function createAvailability(dc: DataConnect, vars: CreateAvailabilityVariables): MutationPromise<CreateAvailabilityData, CreateAvailabilityVariables>;

interface UpdateAvailabilityRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateAvailabilityVariables): MutationRef<UpdateAvailabilityData, UpdateAvailabilityVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdateAvailabilityVariables): MutationRef<UpdateAvailabilityData, UpdateAvailabilityVariables>;
  operationName: string;
}
export const updateAvailabilityRef: UpdateAvailabilityRef;

export function updateAvailability(vars: UpdateAvailabilityVariables): MutationPromise<UpdateAvailabilityData, UpdateAvailabilityVariables>;
export function updateAvailability(dc: DataConnect, vars: UpdateAvailabilityVariables): MutationPromise<UpdateAvailabilityData, UpdateAvailabilityVariables>;

interface DeleteAvailabilityRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: DeleteAvailabilityVariables): MutationRef<DeleteAvailabilityData, DeleteAvailabilityVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: DeleteAvailabilityVariables): MutationRef<DeleteAvailabilityData, DeleteAvailabilityVariables>;
  operationName: string;
}
export const deleteAvailabilityRef: DeleteAvailabilityRef;

export function deleteAvailability(vars: DeleteAvailabilityVariables): MutationPromise<DeleteAvailabilityData, DeleteAvailabilityVariables>;
export function deleteAvailability(dc: DataConnect, vars: DeleteAvailabilityVariables): MutationPromise<DeleteAvailabilityData, DeleteAvailabilityVariables>;

interface GetAvailabilityRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetAvailabilityVariables): QueryRef<GetAvailabilityData, GetAvailabilityVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetAvailabilityVariables): QueryRef<GetAvailabilityData, GetAvailabilityVariables>;
  operationName: string;
}
export const getAvailabilityRef: GetAvailabilityRef;

export function getAvailability(vars: GetAvailabilityVariables, options?: ExecuteQueryOptions): QueryPromise<GetAvailabilityData, GetAvailabilityVariables>;
export function getAvailability(dc: DataConnect, vars: GetAvailabilityVariables, options?: ExecuteQueryOptions): QueryPromise<GetAvailabilityData, GetAvailabilityVariables>;

interface ListAvailabilitiesRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListAvailabilitiesData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListAvailabilitiesData, undefined>;
  operationName: string;
}
export const listAvailabilitiesRef: ListAvailabilitiesRef;

export function listAvailabilities(options?: ExecuteQueryOptions): QueryPromise<ListAvailabilitiesData, undefined>;
export function listAvailabilities(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<ListAvailabilitiesData, undefined>;

