declare module "langdetect" {
  export function detect(text: string): string;
  export function detectAll(text: string): string[];
}
