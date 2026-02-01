export function StructuredData() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "Puppetgram",
    "applicationCategory": "BusinessApplication",
    "operatingSystem": "Web",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD",
      "availability": "https://schema.org/InStock"
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.8",
      "reviewCount": "120"
    },
    "author": {
      "@type": "Organization",
      "name": "Puppetgram",
      "url": "https://puppetgram.ru",
      "logo": "https://puppetgram.ru/bot-avatar-masks.svg",
      "sameAs": [
        "https://github.com/litury/puppetgram",
        "https://t.me/divatoz"
      ]
    },
    "description": "AI-платформа для роста личного бренда в Telegram через умные комментарии",
    "screenshot": "https://puppetgram.ru/og-image.png"
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
