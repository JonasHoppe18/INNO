/**
 * @typedef {Object} Thread
 * @property {string} id
 * @property {string | null} user_id
 * @property {string | null} mailbox_id
 * @property {string | null} provider
 * @property {string | null} provider_thread_id
 * @property {string | null} subject
 * @property {string | null} snippet
 * @property {string | null} last_message_at
 * @property {number | null} unread_count
 * @property {string | null} created_at
 * @property {string | null} updated_at
 */

/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {string | null} user_id
 * @property {string | null} mailbox_id
 * @property {string | null} thread_id
 * @property {string | null} provider
 * @property {string | null} provider_message_id
 * @property {string | null} subject
 * @property {string | null} snippet
 * @property {string | null} body_text
 * @property {string | null} body_html
 * @property {string | null} clean_body_text
 * @property {string | null} clean_body_html
 * @property {string | null} quoted_body_text
 * @property {string | null} quoted_body_html
 * @property {string | null} from_name
 * @property {string | null} from_email
 * @property {string[] | null} to_emails
 * @property {string[] | null} cc_emails
 * @property {string[] | null} bcc_emails
 * @property {boolean | null} is_read
 * @property {string | null} sent_at
 * @property {string | null} received_at
 * @property {string | null} created_at
 * @property {string | null} updated_at
 * @property {string | null} ai_draft_text
 */

/**
 * @typedef {Object} Attachment
 * @property {string} id
 * @property {string | null} user_id
 * @property {string | null} mailbox_id
 * @property {string | null} message_id
 * @property {string | null} provider
 * @property {string | null} provider_attachment_id
 * @property {string | null} filename
 * @property {string | null} mime_type
 * @property {number | null} size_bytes
 * @property {string | null} storage_path
 * @property {string | null} created_at
 */

/**
 * @typedef {Object} TicketUIState
 * @property {"New" | "Open" | "Waiting" | "Solved"} status
 * @property {string | null} assignee
 * @property {"Low" | "Normal" | "High" | null} priority
 */

/**
 * @typedef {Object} ActionEvent
 * @property {string} id
 * @property {string} threadId
 * @property {string} title
 * @property {string | null} statusLabel
 * @property {string} timestamp
 */

/**
 * @typedef {Object} CustomerProfile
 * @property {string} name
 * @property {string} email
 * @property {string} tier
 * @property {string} spent
 * @property {number} ordersCount
 * @property {Array<{ id: string, status: string }>} recentOrders
 */

export {};
