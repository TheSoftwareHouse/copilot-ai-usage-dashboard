import { EntitySchema } from "typeorm";

export interface TeamMemberSnapshot {
  id: number;
  teamId: number;
  seatId: number;
  month: number;
  year: number;
  allocationPercentage: number;
  createdAt: Date;
}

export const TeamMemberSnapshotEntity = new EntitySchema<TeamMemberSnapshot>({
  name: "TeamMemberSnapshot",
  tableName: "team_member_snapshot",
  columns: {
    id: {
      type: "int",
      primary: true,
      generated: "increment",
    },
    teamId: {
      type: "int",
    },
    seatId: {
      type: "int",
    },
    month: {
      type: "smallint",
    },
    year: {
      type: "smallint",
    },
    allocationPercentage: {
      type: "smallint",
      default: 100,
    },
    createdAt: {
      type: "timestamptz",
      createDate: true,
    },
  },
  relations: {
    teamId: {
      type: "many-to-one",
      target: "Team",
      joinColumn: {
        name: "teamId",
        referencedColumnName: "id",
      },
    },
    seatId: {
      type: "many-to-one",
      target: "CopilotSeat",
      joinColumn: {
        name: "seatId",
        referencedColumnName: "id",
      },
    },
  },
  indices: [
    {
      name: "IDX_team_member_snapshot_team_month",
      columns: ["teamId", "month", "year"],
    },
    {
      name: "IDX_team_member_snapshot_seat",
      columns: ["seatId"],
    },
  ],
  uniques: [
    {
      name: "UQ_team_member_snapshot",
      columns: ["teamId", "seatId", "month", "year"],
    },
  ],
});
