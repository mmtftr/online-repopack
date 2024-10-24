// marks end of data flow // stops the iterator
const END = Symbol();
type END = typeof END;

export class AsyncGeneratorCallback<T> implements Disposable, AsyncIterable<T> {
  public async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length) {
        const next = this.queue.shift()!;

        if (next === END) {
          break;
        } else {
          yield next;
        }
      } else {
        const next = await new Promise<T | END>((resolve) => {
          this.link = (value) => {
            this.link = (value) => {
              this.queue.push(value);
            };
            resolve(value);
          };
        });

        if (next === END) {
          break;
        } else {
          yield next;
        }
      }
    }
  }

  private queue: (T | END)[] = [];

  private link: (value: T | END) => void = (value) => {
    this.queue.push(value);
  };

  public call(value: T) {
    this.link(value);
  }

  [Symbol.dispose]() {
    this.link(END);
  }
}