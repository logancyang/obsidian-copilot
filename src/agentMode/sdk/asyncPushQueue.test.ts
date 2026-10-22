import { AsyncPushQueue } from "./asyncPushQueue";

async function drain<T>(queue: AsyncPushQueue<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of queue) items.push(item);
  return items;
}

describe("asyncPushQueue", () => {
  describe("AsyncPushQueue", () => {
    describe("push()", () => {
      it("yields items in push order, including items pushed while the reader waits", async () => {
        const queue = new AsyncPushQueue<string>();
        queue.push("a");
        const read = drain(queue);

        queue.push("b");
        queue.push("c");
        queue.end();

        await expect(read).resolves.toEqual(["a", "b", "c"]);
      });

      it("drops items pushed after the queue ended", async () => {
        const queue = new AsyncPushQueue<string>();
        queue.push("a");
        queue.end();
        queue.push("late");

        await expect(drain(queue)).resolves.toEqual(["a"]);
      });
    });

    describe("end()", () => {
      it("finishes a reader that is waiting for the next item", async () => {
        const queue = new AsyncPushQueue<number>();
        const read = drain(queue);

        queue.end();

        await expect(read).resolves.toEqual([]);
      });
    });
  });
});
