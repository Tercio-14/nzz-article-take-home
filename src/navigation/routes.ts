// The stack's routes. Kept in their own module so screens and the navigator agree on the shapes.

export type RootStackParamList = {
  Front: undefined;
  /** `path` keeps the query string, which has to travel with the article. */
  Article: { path: string; articleId: string };
};
