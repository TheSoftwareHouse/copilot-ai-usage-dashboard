import { EntitySchema } from "typeorm";
import { ApiMode } from "./enums";

export interface Configuration {
  id: number;
  singletonKey: string;
  apiMode: ApiMode;
  entityName: string;
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
      default: ApiMode.ORGANISATION,
      nullable: true,
    },
    entityName: {
      type: "varchar",
      length: 255,
      nullable: true,
    },
    normSeatsCount: {
      type: "int",
      default: 30,
    },
    deviationWarningThreshold: {
      type: "decimal",
      precision: 7,
      scale: 2,
      default: 500,
    },
    deviationAlertThreshold: {
      type: "decimal",
      precision: 7,
      scale: 2,
      default: 1000,
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
