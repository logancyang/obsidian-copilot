declare module "*stories.generated" {
  export interface GeneratedStoryModule {
    readonly componentId: string | null;
    readonly load: () => Promise<unknown>;
  }

  export const modules: readonly GeneratedStoryModule[];
  export const presentationalComponentCount: number;
}
