import { EntitySchema } from "typeorm";
import { ApiMode } from "./enums";

export interface Configuration {
  id: number;
  singletonKey: string;
  apiMode: ApiMode;
  entityName: string;
  premiumRequestsPerSeat: number;
  telemetryApiKey: string | null;
  normSeatsCount: number;
  deviationWarningThreshold: number;
  deviationAlertThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

export const ConfigurationEntity = new EntitySchema<Configuration>({
  name: "Configuration",
  tableName: "configuration",
  columns: {
    id: {
      type: "int",
      primary: true,
      generated: "increment",
    },
    singletonKey: {
      type: "varchar",
      length: 10,
      default: "GLOBAL",
      unique: true,
    },
    apiMode: {
      type: "enum",
      enum: ApiMode,
    },
    entityName: {
      type: "varchar",
      length: 255,
    },
    premiumRequestsPerSeat: {
      type: "int",
      default: 300,
    },
    telemetryApiKey: {
      type: "varchar",
      length: 255,
      nullable: true,
      default: null,
    },
    normSeatsCount: {
      type: "int",
      default: 30,
    },
    deviationWarningThreshold: {
      type: "decimal",
      precision: 5,
      scale: 2,
      default: 1.5,
    },
    deviationAlertThreshold: {
      type: "decimal",
      precision: 5,
      scale: 2,
      default: 2.0,
    },
    createdAt: {
      type: "timestamptz",
      createDate: true,
    },
    updatedAt: {
      type: "timestamptz",
      updateDate: true,
    },
  },
});
