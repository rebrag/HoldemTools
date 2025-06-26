# HoldemTools API

![Build](https://github.com/<your‑user>/<repo>/actions/workflows/azure-webapps.yml/badge.svg)
![Azure Web App](https://img.shields.io/website?url=https%3A%2F%2F<your-app>.azurewebsites.net%2Fswagger)

A lightweight **ASP‑NET Core 8 Web API** that serves pre‑flop poker solver data (ranges, EVs, metadata) directly from Azure Data Lake Storage. Built for the [HoldemTools](https://holdemtools.com) React front‑end, but generic enough to power any poker‑analysis workflow.

---

\## Features

| ✅                                                                                             | Capability |
| --------------------------------------------------------------------------------------------- | ---------- |
| Lists top‑level solver folders ("constellations")                                             |            |
| Lists JSON/RNG files inside a selected folder                                                 |            |
| Streams raw file contents (for React or data‑science consumers)                               |            |
| **Swagger UI** out of the box for easy testing                                                |            |
| **CI / CD** – GitHub Actions → Azure App Service (single‑click deploy)                        |            |
| Secrets kept **100 % out of source control** via *dotnet user‑secrets* & App Service settings |            |

---

\## Tech Stack

* **.NET 8** & ASP‑NET Core Minimal APIs / Controllers
* **Azure Storage SDK** (Data Lake + Blob) – SDK v12
* **GitHub Actions** → `azure/webapps‑deploy@v3`
* **Azure App Service** (Linux, Standard B1)
* **OpenAPI / Swashbuckle** for docs & client code‑gen

---

\## Quick Start (local)

```bash
# Clone
$ git clone https://github.com/<your‑user>/<repo>.git && cd HoldemToolsAPI

# Configure secrets (never committed)
$ dotnet user-secrets init
$ dotnet user-secrets set "AzureStorage:ConnectionString" "<YOUR‑CONN‑STRING>"
$ dotnet user-secrets set "AzureStorage:ContainerName"  "onlinerangedata"  # optional

# Run with hot‑reload
$ dotnet watch run

# Swagger → https://localhost:5001/swagger
```

> **Prerequisites:** .NET 8 SDK + PowerShell/Bash. No SQL server, queues, or extra services required.

---

\## HTTP Endpoints (v1)

| Method | Route                           | Description                     |
| ------ | ------------------------------- | ------------------------------- |
| GET    | `/api/files/folders`            | List unique top‑level folders   |
| GET    | `/api/files/listJSONs/{folder}` | List JSON/RNG files in a folder |
| GET    | `/api/files/{folder}/{file}`    | Stream file contents            |

All endpoints return `200 OK` with JSON (or raw text) or `404 Not Found` if the blob is missing.

---

\## Configuration

| Setting                       | Local (user‑secrets)            | Azure (App Settings)             | Example                                                                   |
| ----------------------------- | ------------------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| **Storage connection string** | `AzureStorage:ConnectionString` | `AzureStorage__ConnectionString` | `DefaultEndpointsProtocol=…;AccountKey=…;EndpointSuffix=core.windows.net` |
| **Container name**            | `AzureStorage:ContainerName`    | `AzureStorage__ContainerName`    | `onlinerangedata`                                                         |
| **CORS origins** (optional)   | `App:AllowedOrigins`            | `App__AllowedOrigins`            | `https://holdemtools.com`                                                 |

---

\## CI / CD Pipeline

1. **Push → GitHub** (`main` branch).
2. **GitHub Actions** builds → `dotnet publish`.
3. Artifacts deployed via `azure/webapps-deploy@v3` using an encrypted *publish profile* secret.
4. Azure restarts, health‑checks swagger, and slots the build live.

Average build + deploy time: **< 60 s**.

---

\## Integrating with the React front‑end

```env
# frontend/.env.local
VITE_API_URL=https://<your-app>.azurewebsites.net
```

```ts
// src/lib/api.ts
import axios from "axios";
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});
```

---

\## Folder Structure (API project)

```
PokerRangeAPI2/
 ├─ Controllers/
 │  └─ FilesController.cs     # core endpoints
 ├─ Properties/
 ├─ appsettings.json
 ├─ Program.cs               # bootstraps DI + Swagger
 └─ …
```

---

\## Roadmap / TODO

* [ ] Pagination for very large folders
* [ ] Caching layer (Redis) for hot blobs
* [ ] Role‑based auth (JWT → Azure AD B2C)
* [ ] Unit tests (xUnit) & code‑coverage badge

---

\## Contributing

Pull requests, feature ideas, and bug reports are welcome!<br>
Please open an issue first to discuss significant changes.

1. Fork ➜ branch ➜ PR
2. `dotnet test` & `dotnet format` must pass.

---

\## License

MIT © 2025 Joshua Garber

> *This project is for educational and portfolio purposes; no affiliation with any commercial poker solver tools.*
