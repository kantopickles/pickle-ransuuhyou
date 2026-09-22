"use client";

import { useRef, useState } from "react";
import { COMMUNITY_EVENTS, COMMUNITY_LINKS } from "../lib/community-content";

export default function ShareCommunityPanel() {
  const eventListRef = useRef<HTMLDivElement>(null);
  const [currentEvent, setCurrentEvent] = useState(0);

  function updateCurrentEvent() {
    const list = eventListRef.current;
    if (!list) return;

    const cards = Array.from(list.children) as HTMLElement[];
    const nearest = cards.reduce((best, card, index) => {
      const cardPosition = card.offsetLeft - list.offsetLeft;
      const distance = Math.abs(cardPosition - list.scrollLeft);
      return distance < best.distance ? { index, distance } : best;
    }, { index: 0, distance: Number.POSITIVE_INFINITY });

    setCurrentEvent(nearest.index);
  }

  function moveToEvent(index: number) {
    const list = eventListRef.current;
    const card = list?.children[index] as HTMLElement | undefined;
    if (!list || !card) return;
    list.scrollTo({ left: card.offsetLeft - list.offsetLeft, behavior: "smooth" });
    setCurrentEvent(index);
  }

  return (
    <aside className="community-panel" aria-label="関東ピックルズからのお知らせ">
      <div className="community-social-grid">
        <div className="community-social-item">
          <a
            className="community-social-button community-instagram"
            href={COMMUNITY_LINKS.instagram}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="instagram-mark" aria-hidden="true"><span /></span>
            <span>インスタ</span>
            <span className="community-link-arrow" aria-hidden="true">›</span>
          </a>
          <p>日々の活動を見て下さい！</p>
        </div>

        <div className="community-social-item">
          {COMMUNITY_LINKS.line ? (
            <a
              className="community-social-button community-line"
              href={COMMUNITY_LINKS.line}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="line-mark" aria-hidden="true">LINE</span>
              <span>公式LINE</span>
              <span className="community-link-arrow" aria-hidden="true">›</span>
            </a>
          ) : (
            <span className="community-social-button community-line is-disabled" aria-label="公式LINEは準備中です">
              <span className="line-mark" aria-hidden="true">LINE</span>
              <span>公式LINE</span>
              <span className="social-preparing">準備中</span>
            </span>
          )}
          <p>個別で問い合わせしたい方はこちら！</p>
        </div>
      </div>

      {COMMUNITY_EVENTS.length ? (
        <section className="community-events" aria-labelledby="community-events-title">
          <div className="community-events-heading">
            <h2 id="community-events-title">大会・練習会情報</h2>
            <a href="https://pikura.app/events" target="_blank" rel="noopener noreferrer">
              すべて見る <span aria-hidden="true">›</span>
            </a>
          </div>

          <div
            className="community-event-list"
            ref={eventListRef}
            onScroll={updateCurrentEvent}
            aria-label="大会・練習会情報一覧"
          >
            {COMMUNITY_EVENTS.map((event) => (
              <article className="community-event-card" key={`${event.date}-${event.title}`}>
                <div className="community-event-date" aria-label={`${event.date} ${event.day}曜日`}>
                  <strong>{event.date}</strong>
                  <span>{event.day}</span>
                </div>
                <div className="community-event-copy">
                  <h3>{event.title}</h3>
                  <p><span aria-hidden="true">●</span>{event.location}</p>
                  <div className="community-event-footer">
                    <span className="community-event-status">{event.status}</span>
                    <a href={event.url} target="_blank" rel="noopener noreferrer">
                      詳細 <span aria-hidden="true">›</span>
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="community-event-controls" aria-label="大会・練習会情報のページ送り">
            <button
              type="button"
              onClick={() => moveToEvent(Math.max(0, currentEvent - 1))}
              disabled={currentEvent === 0}
              aria-label="前の情報"
            >
              ‹
            </button>
            <span aria-live="polite">{currentEvent + 1} / {COMMUNITY_EVENTS.length}</span>
            <button
              type="button"
              onClick={() => moveToEvent(Math.min(COMMUNITY_EVENTS.length - 1, currentEvent + 1))}
              disabled={currentEvent === COMMUNITY_EVENTS.length - 1}
              aria-label="次の情報"
            >
              ›
            </button>
          </div>
        </section>
      ) : null}
    </aside>
  );
}
