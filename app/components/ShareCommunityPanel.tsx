"use client";

import { useRef, useState } from "react";
import {
  COMMUNITY_LINKS,
  COMMUNITY_PRACTICE_EVENTS,
  COMMUNITY_TOURNAMENT_EVENTS
} from "../lib/community-content";

type EventCategory = "practice" | "tournament";

export default function ShareCommunityPanel() {
  const eventListRef = useRef<HTMLDivElement>(null);
  const [currentEvent, setCurrentEvent] = useState(0);
  const [eventCategory, setEventCategory] = useState<EventCategory>("practice");
  const events = eventCategory === "practice" ? COMMUNITY_PRACTICE_EVENTS : COMMUNITY_TOURNAMENT_EVENTS;
  const categoryLabel = eventCategory === "practice" ? "練習会情報" : "大会情報";

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

  function selectCategory(category: EventCategory) {
    setEventCategory(category);
    setCurrentEvent(0);
    eventListRef.current?.scrollTo({ left: 0 });
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

      <section className="community-events" aria-label="練習会・大会のお知らせ">
          <div className="community-events-heading">
            <div className="community-event-tabs" role="tablist" aria-label="情報の種類">
              <button
                type="button"
                role="tab"
                aria-selected={eventCategory === "practice"}
                aria-controls="community-event-panel"
                onClick={() => selectCategory("practice")}
              >
                練習会情報
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={eventCategory === "tournament"}
                aria-controls="community-event-panel"
                onClick={() => selectCategory("tournament")}
              >
                大会情報
              </button>
            </div>
            <a
              href={eventCategory === "practice" ? COMMUNITY_LINKS.instagram : "https://pikura.app/events"}
              target="_blank"
              rel="noopener noreferrer"
            >
              {eventCategory === "practice" ? "インスタを見る" : "すべて見る"} <span aria-hidden="true">›</span>
            </a>
          </div>

          <div id="community-event-panel" role="tabpanel" aria-label={categoryLabel}>
            {events.length ? (
              <>
                <div
                  className="community-event-list"
                  ref={eventListRef}
                  onScroll={updateCurrentEvent}
                  aria-label={`${categoryLabel}一覧`}
                >
                  {events.map((event) => (
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

                <div className="community-event-controls" aria-label={`${categoryLabel}のページ送り`}>
                  <button
                    type="button"
                    onClick={() => moveToEvent(Math.max(0, currentEvent - 1))}
                    disabled={currentEvent === 0}
                    aria-label="前の情報"
                  >
                    ‹
                  </button>
                  <span aria-live="polite">{currentEvent + 1} / {events.length}</span>
                  <button
                    type="button"
                    onClick={() => moveToEvent(Math.min(events.length - 1, currentEvent + 1))}
                    disabled={currentEvent === events.length - 1}
                    aria-label="次の情報"
                  >
                    ›
                  </button>
                </div>
              </>
            ) : (
              <div className="community-event-empty">
                <strong>練習会の最新情報</strong>
                <p>開催予定や募集状況はインスタでお知らせしています。</p>
                <a href={COMMUNITY_LINKS.instagram} target="_blank" rel="noopener noreferrer">
                  インスタで確認 <span aria-hidden="true">›</span>
                </a>
              </div>
            )}
          </div>
        </section>
    </aside>
  );
}
