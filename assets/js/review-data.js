/* Data Reviews Sadalan — dimuat dari data/reviews.json (lewat Store).
   Field: id, cat (sesuai site.reviewCategories), title, loc, rating (1-5), author, iso (YYYY-MM-DD), img,
   text (ringkasan), body (paragraf lengkap untuk halaman detail), pros, cons, tags.
   Pencarian menelusuri SEMUA field di atas. */
const REVIEW_SEED=Store.data.reviews;
