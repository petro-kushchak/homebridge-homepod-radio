import http from 'http';
import { Logging } from 'homebridge';

export interface AutomationReturn {
  error: boolean;
  message: string;
  cooldownActive?: boolean;
}

export type HttpHandler = (uri: string) => Promise<AutomationReturn>;

export class HttpService {
  private readonly server: http.Server;

  constructor(private httpPort: number, private logger: Logging) {
      this.logger.info('Setting up HTTP server on port ' + this.httpPort + '...');
      this.server = http.createServer();
  }

  public stop(): void {
      this.server.close();
  }

  async start(httpHandler: HttpHandler): Promise<void> {
      this.server.listen(this.httpPort);
      this.server.on(
          'request',
          async (request: http.IncomingMessage, response: http.ServerResponse) => {
              let result: AutomationReturn = {
                  error: true,
                  message: 'Malformed URL.',
              };
              if (request.url) {
                  result = await httpHandler(request.url);
              }
              response.writeHead(result.error ? 500 : 200);
              response.write(JSON.stringify(result));
              response.end();
          },
      );
  }
}
