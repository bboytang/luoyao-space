export interface UserIdentity {
  userId: string;
  createdAt: string;
}

export interface CompanionIdentity {
  companionId: string;
  name: string;
  userId: string;
}

export interface DeviceIdentity {
  deviceId: string;
  userId: string;
  runtime: "web" | "ios" | "android" | "desktop" | "iot";
  label?: string;
}

export interface RelationshipIdentity {
  relationshipId: string;
  userId: string;
  companionId: string;
}
