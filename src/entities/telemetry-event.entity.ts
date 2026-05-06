import { EntitySchema } from "typeorm";

export interface TelemetryEvent {
  id: number;
  batchId: string;
  schemaVersion: string;
  timestamp: Date;
  hookTimestamp: Date;
  sessionId: string;
  eventType: string;
  workspaceName: string;
  data: Record<string, unknown>;
  eventHash: string;
  githubUsername: string | null;
  createdAt: Date;
}

export const TelemetryEventEntity = new EntitySchema<TelemetryEvent>({
  name: "TelemetryEvent",
  tableName: "telemetry_event",
  columns: {
    id: {
      type: "int",
      primary: true,
      generated: "increment",
    },
    batchId: {
      type: "uuid",
    },
    schemaVersion: {
      type: "varchar",
      length: 10,
    },
    timestamp: {
      type: "timestamptz",
    },
    hookTimestamp: {
      type: "timestamptz",
    },
    sessionId: {
      type: "varchar",
      length: 36,
    },
    eventType: {
      type: "varchar",
      length: 20,
    },
    workspaceName: {
      type: "varchar",
      length: 255,
    },
    data: {
      type: "jsonb",
    },
    eventHash: {
      type: "varchar",
      length: 64,
    },
    githubUsername: {
      type: "varchar",
      length: 255,
      nullable: true,
      default: null,
    },
    createdAt: {
      type: "timestamptz",
      createDate: true,
    },
  },
  indices: [
    {
      name: "UQ_telemetry_event_hash",
      columns: ["eventHash"],
      unique: true,
    },
    {
      name: "IDX_telemetry_event_session_id",
      columns: ["sessionId"],
    },
    {
      name: "IDX_telemetry_event_batch_id",
      columns: ["batchId"],
    },
    {
      name: "IDX_telemetry_event_type_created",
      columns: ["eventType", "createdAt"],
    },
    {
      name: "IDX_telemetry_event_github_username",
      columns: ["githubUsername"],
    },
  ],
});
