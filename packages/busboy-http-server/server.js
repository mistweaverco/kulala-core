import http from "node:http";
import { inspect } from "node:util";
import { Busboy } from "@fastify/busboy";
const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    if (req.method === "POST") {
      const busboy = new Busboy({ headers: req.headers });
      busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
        console.log(
          `File [${fieldname}]: filename: ${filename}, encoding: ${encoding}, mimetype: ${mimetype}`,
        );
        file.on("data", (data) => {
          console.log(`File [${fieldname}] got ${data.length} bytes`);
        });
        file.on("end", () => {
          console.log(`File [${fieldname}] Finished`);
        });
      });
      busboy.on("field", (fieldname, val) => {
        console.log(`Field [${fieldname}]: value: ${inspect(val)}`);
      });
      busboy.on("finish", () => {
        console.log("Done parsing form!");
        res.end("Upload complete");
      });
      req.pipe(busboy);
    } else if (req.method === "GET") {
      res.writeHead(200, { Connection: "close" });
      res.end(`<html><head></head><body>
               <form method="POST" enctype="multipart/form-data">
                <input type="text" name="textfield"><br>
                <input type="file" name="filefield"><br>
                <input type="submit">
              </form>
            </body></html>`);
    }
  })
  .listen(PORT, () => {
    console.log("Listening for requests on http://localhost:" + PORT);
  });
