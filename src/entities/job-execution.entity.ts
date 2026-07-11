import { EntitySchema } from "typeorm";
import { JobType, JobStatus } from "./enums";

export interface JobExecution {
  id: number;
  jobType: JobType;
  status: JobStatus;
  reason: string | null;
  startedAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
  recordsProcessed: number | null;
  createdAt: Date;
}

export const JobExecutionEntity = new EntitySchema<JobExecution>({
  name: "JobExecution",
  tableName: "job_execution",
  columns: {
    id: {
      type: "int",
      primary: true,
      generated: "increment",
    },
    jobType: {
      type: "enum",
      // Includes retired values to keep historical rows queryable.
      enum: JobType,
    },
    status: {
      type: "enum",
      enum: JobStatus,
    },
    reason: {
      type: "varchar",
      length: 64,
      nullable: true,
    },
    startedAt: {
      type: "timestamptz",
    },
    completedAt: {
      type: "timestamptz",
      nullable: true,
    },
    errorMessage: {
      type: "text",
      nullable: true,
    },
    recordsProcessed: {
      type: "int",
      nullable: true,
    },
    createdAt: {
      type: "timestamptz",
      createDate: true,
    },
  },
  indices: [
    {
      name: "IDX_job_execution_type_started",
      columns: ["jobType", "startedAt"],
    },
  ],
});
