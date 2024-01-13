function logError(...args: any[]) {
  console.error("[🍊] ", ...args);
}

function createDebugger(debug: boolean) {
  return (...args: any[]) => {
    if (debug) {
      console.log("[🍊] ", ...args);
    }
  };
}

function getConfig(url?: string): { api: string } {
  if (url) {
    return {
      api: url,
    };
  }
  return {
    api: "https://zenblog.com/api/public",
  };
}

function throwError(msg: string, ...args: any[]) {
  logError(msg, ...args);
  throw new Error("[🚨] " + msg);
}

export type Post = {
  slug: string;
  title: string;
  content?: any;
  cover_image?: string;
  created_at: string;
  updated_at: string;
};

export type PostWithContent = Post & {
  content: string;
};

export type CreateClientOpts = {
  blogId: string;
  _url?: string;
  debug?: boolean;
};

export function createClient({ blogId, _url, debug }: CreateClientOpts) {
  const config = getConfig(_url);
  const log = createDebugger(debug || false);
  log("createClient ", config);

  async function _fetch(path: string, opts: RequestInit) {
    const URL = `${config.api}/${blogId}/${path}`;

    log("fetching ", URL, opts);
    const res = await fetch(URL, opts);
    const json = await res.json();
    log("res", {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      json,
    });
    if (!res.ok) {
      throwError("Error fetching data from API", res);
    }

    return json;
  }

  if (!blogId) {
    throwError("blogId is required");
  }

  return {
    posts: {
      getAll: async function (): Promise<Post[]> {
        const posts = await _fetch(`posts`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });
        log("posts.getAll", posts);

        const normalizedPosts = posts.map((post: any) => {
          return {
            slug: post.slug,
            title: post.title,
            created_at: post.created_at,
            updated_at: post.updated_at,
            cover_image: post.cover_image,
          };
        });

        return normalizedPosts as Post[]; // to do: validate
      },
      getBySlug: async function (slug: string): Promise<PostWithContent> {
        const post = await _fetch(`post/${slug}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        return post as PostWithContent; // to do: validate
      },
    },
  };
}
