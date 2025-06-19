export class FileLink {
  attachementFolder: string;
  basePath: string;

  constructor(attachementFolder: string, basePath: string) {
    this.attachementFolder = attachementFolder;
    this.basePath = basePath;
  }

  embedFile(file: File) {
    console.log("attached file path: " + this.attachementFolder);
    console.log("vault path: " + this.basePath);
    console.log("file: " + file.name);
  }
}
